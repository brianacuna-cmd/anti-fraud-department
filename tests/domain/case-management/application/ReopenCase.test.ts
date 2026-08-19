import { createReopenCaseUseCase } from '../../../../src/modules/case-management/application/ReopenCase.js';
import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryOutboxRepository } from '../../../helpers/case-management/InMemoryOutboxRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import {
  createCaseSlaTrackingId,
  generateCaseSlaTrackingId,
} from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const OPENED_AT = fromDate(new Date('2026-05-01T08:00:00.000Z'));
const NOW = fromDate(new Date('2026-06-01T10:00:00.000Z'));
const ORG_1 = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });
const ORG_2 = createAuthContext({ userId: 'analyst-2', organizationId: 'org-2', actorType: 'USER' });

/** Vencimiento del ciclo anterior: ya caducado hace un mes. */
const STALE_DUE_DATE = fromDate(new Date('2026-05-01T09:00:00.000Z'));

function build(status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'ARCHIVED') {
  const cases = new InMemoryCaseRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const outbox = new InMemoryOutboxRepository();

  let kase = Case.create({
    id: generateCaseId(),
    organizationId: 'org-1',
    customerId: 'customer-1',
    riskScore: createRiskScore(80),
    priority: createCasePriority('HIGH'),
    now: OPENED_AT,
  }).withDueDate(STALE_DUE_DATE, OPENED_AT);

  if (status !== 'OPEN') kase = kase.transitionTo('IN_REVIEW', OPENED_AT);
  if (status === 'RESOLVED' || status === 'ARCHIVED') kase = kase.transitionTo('RESOLVED', OPENED_AT);
  if (status === 'ARCHIVED') kase = kase.transitionTo('ARCHIVED', OPENED_AT);

  void cases.save(kase);

  slaTracking.seed(
    CaseSlaTracking.create({
      id: createCaseSlaTrackingId('tracking-1'),
      caseId: kase.id,
      dueDate: STALE_DUE_DATE,
      now: OPENED_AT,
    })
      .advanceTo('WARNING', OPENED_AT)
      .advanceTo('BREACHED', OPENED_AT),
  );

  const reopenCase = createReopenCaseUseCase({
    cases,
    timelineRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    auditRecorder,
    outbox,
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking,
      fraudConfig: new InMemoryOrganizationFraudConfigRepository(),
      generateCaseSlaTrackingId,
    }),
  });

  return { cases, timelineRecorder, auditRecorder, slaTracking, outbox, kase, reopenCase };
}

describe('createReopenCaseUseCase', () => {
  it.each(['RESOLVED', 'ARCHIVED'] as const)('reopens a %s case into IN_REVIEW', async (status) => {
    const { kase, reopenCase } = build(status);

    const result = await reopenCase({ auth: ORG_1, caseId: kase.id });

    expect(result.status).toBe('IN_REVIEW');
  });

  it('restarts the SLA clock instead of inheriting the expired deadline', async () => {
    const { kase, reopenCase, slaTracking } = build('RESOLVED');

    const result = await reopenCase({ auth: ORG_1, caseId: kase.id });

    // HIGH por defecto son 60 minutos contados desde AHORA, no desde el ciclo
    // anterior. Sin el reinicio el caso naceria ya incumpliendo su propio SLA.
    expect(result.dueDate).toBe('2026-06-01T11:00:00.000Z');
    expect(result.dueDate).not.toBe(STALE_DUE_DATE);

    const tracking = slaTracking.all();
    expect(tracking).toHaveLength(1);
    expect(tracking[0]?.status).toBe('ON_TRACK');
    expect(tracking[0]?.notificationSent).toBe(false);
  });

  it('resets a BREACHED tracking row, which has no forward transition of its own', async () => {
    const { kase, reopenCase, slaTracking } = build('ARCHIVED');

    await reopenCase({ auth: ORG_1, caseId: kase.id });

    expect(slaTracking.all()[0]?.status).toBe('ON_TRACK');
  });

  it('records both the reopening and the clock reset on the timeline', async () => {
    const { kase, reopenCase, timelineRecorder } = build('RESOLVED');

    await reopenCase({ auth: ORG_1, caseId: kase.id });

    const events = timelineRecorder.all();
    expect(events.map((e) => e.eventType).sort()).toEqual(['CASE_REOPENED', 'SLA_RESET']);

    const reopened = events.find((e) => e.eventType === 'CASE_REOPENED');
    expect(reopened?.previousValue).toBe('RESOLVED');
    expect(reopened?.newValue).toBe('IN_REVIEW');

    const slaReset = events.find((e) => e.eventType === 'SLA_RESET');
    expect(slaReset?.previousValue).toBe(STALE_DUE_DATE);
    expect(slaReset?.newValue).toBe('2026-06-01T11:00:00.000Z');
  });

  it('publishes a case.reopened outbox event', async () => {
    const { kase, reopenCase, outbox } = build('RESOLVED');

    await reopenCase({ auth: ORG_1, caseId: kase.id, reason: 'Nueva evidencia aportada' });

    const events = outbox.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('case.reopened');
    expect(events[0]?.status).toBe('PENDING');
    expect(events[0]?.payload).toMatchObject({
      previousStatus: 'RESOLVED',
      nextStatus: 'IN_REVIEW',
      reason: 'Nueva evidencia aportada',
    });
  });

  it('records a REOPEN_CASE audit row carrying both deadlines', async () => {
    const { kase, reopenCase, auditRecorder } = build('RESOLVED');

    await reopenCase({ auth: ORG_1, caseId: kase.id });

    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('REOPEN_CASE');
    expect(auditRecorder.all()[0]?.detail).toMatchObject({
      previousStatus: 'RESOLVED',
      previousDueDate: STALE_DUE_DATE,
      dueDate: '2026-06-01T11:00:00.000Z',
    });
  });

  it('honours an explicit OPEN destination', async () => {
    const { kase, reopenCase } = build('ARCHIVED');

    const result = await reopenCase({ auth: ORG_1, caseId: kase.id, nextStatus: 'OPEN' });

    expect(result.status).toBe('OPEN');
  });

  it.each(['OPEN', 'IN_REVIEW'] as const)('refuses to reopen a case that is still %s', async (status) => {
    const { kase, reopenCase, slaTracking } = build(status);

    await expect(reopenCase({ auth: ORG_1, caseId: kase.id })).rejects.toThrow(CaseManagementError);

    // El reloj no puede quedar reiniciado sobre un caso que no llego a reabrirse.
    expect(slaTracking.all()[0]?.status).toBe('BREACHED');
  });

  it('rejects a case belonging to another tenant', async () => {
    const { kase, reopenCase } = build('RESOLVED');

    await expect(reopenCase({ auth: ORG_2, caseId: kase.id })).rejects.toThrow(CaseManagementError);
  });
});
