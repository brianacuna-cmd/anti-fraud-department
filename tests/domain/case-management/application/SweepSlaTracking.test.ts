import { oid } from '../../../support/oid.js';
import { createSweepSlaTrackingUseCase } from '../../../../src/modules/case-management/application/SweepSlaTracking.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { createCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const CREATED = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const NOW = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const PAST_DUE = fromDate(new Date('2026-01-01T12:00:00.000Z'));
const FUTURE = fromDate(new Date('2026-01-03T00:00:00.000Z'));
const ORG_1 = oid('org-1');

function buildCase(caseId: string, assignedTo: ReturnType<typeof createAssignedTo> | null) {
  const base = Case.create({
    id: createCaseId(caseId),
    organizationId: ORG_1,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: CREATED,
  });
  return assignedTo === null ? base : base.reassign(assignedTo, CREATED);
}

function buildTracking(id: string, caseId: string, dueDate: typeof NOW, overrides: Partial<{ status: 'ON_TRACK' | 'WARNING'; notified: boolean }> = {}) {
  let tracking = CaseSlaTracking.create({
    id: createCaseSlaTrackingId(id),
    caseId: createCaseId(caseId),
    dueDate,
    now: CREATED,
  });
  if (overrides.status === 'WARNING') {
    tracking = tracking.advanceTo('WARNING', CREATED);
  }
  if (overrides.notified) {
    tracking = tracking.markNotified(CREATED);
  }
  return tracking;
}

function buildUseCase() {
  const cases = new InMemoryCaseRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const notificationSender = new InMemoryCaseManagementNotificationSender();
  const sweepSlaTracking = createSweepSlaTrackingUseCase({
    cases,
    slaTracking,
    notificationSender,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { sweepSlaTracking, cases, slaTracking, notificationSender };
}

describe('createSweepSlaTrackingUseCase', () => {
  it('advances an ON_TRACK due row to WARNING', async () => {
    const { sweepSlaTracking, cases, slaTracking } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.processed).toBe(1);
    expect(result.advanced).toBe(1);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('WARNING');
  });

  it('advances a WARNING due row to BREACHED', async () => {
    const { sweepSlaTracking, cases, slaTracking } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE, { status: 'WARNING' }));

    await sweepSlaTracking();

    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('BREACHED');
  });

  it('skips already-BREACHED rows (never returned by findDueForSweep, defensive re-check)', async () => {
    const { sweepSlaTracking, cases, slaTracking } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    const breached = buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE, { status: 'WARNING' })
      .advanceTo('BREACHED', CREATED);
    await slaTracking.save(breached);

    const result = await sweepSlaTracking();

    expect(result.processed).toBe(0);
    expect(result.advanced).toBe(0);
  });

  it('excludes not-yet-due rows', async () => {
    const { sweepSlaTracking, cases, slaTracking } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), FUTURE));

    const result = await sweepSlaTracking();

    expect(result.processed).toBe(0);
  });

  it('sends SLA_POR_VENCER and marks the row notified on first sweep', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.notified).toBe(1);
    const requests = notificationSender.all();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      organizationId: ORG_1,
      recipientUserId: oid('analyst-1'),
      alertType: 'SLA_POR_VENCER',
    });
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.notificationSent).toBe(true);
  });

  it('does not duplicate the notification when the row is already notified and has not transitioned further', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    const alreadyNotifiedButStillDue = buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE, {
      status: 'WARNING',
      notified: true,
    });
    await slaTracking.save(alreadyNotifiedButStillDue);

    await sweepSlaTracking();

    // The row advances WARNING->BREACHED (still due), but notificationSent stays true
    // and no NEW notification is sent for this already-notified row's prior state.
    expect(notificationSender.all()).toHaveLength(0);
  });

  it('suppresses notification for a ROLE-assigned case but still advances and marks notified (ADR-D4)', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    const role = createAssignedTo('ROLE', oid('role-1'));
    await cases.save(buildCase(oid('case-1'), role));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.advanced).toBe(1);
    expect(result.notified).toBe(0);
    expect(notificationSender.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.notificationSent).toBe(true);
  });

  it('suppresses notification for an unassigned case but still advances and marks notified', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    await cases.save(buildCase(oid('case-1'), null));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.advanced).toBe(1);
    expect(notificationSender.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.notificationSent).toBe(true);
  });

  it('processes each row in its own transaction: one row is unaffected by another failing (ADR-D6)', async () => {
    const cases = new InMemoryCaseRepository();
    const slaTracking = new InMemoryCaseSlaTrackingRepository();
    const notificationSender = new InMemoryCaseManagementNotificationSender();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-ok'), assignee));
    await cases.save(buildCase(oid('case-fail'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-ok'), oid('case-ok'), PAST_DUE));
    await slaTracking.save(buildTracking(oid('tracking-fail'), oid('case-fail'), PAST_DUE));

    let calls = 0;
    const flakyUnitOfWork = {
      async withTransaction<T>(work: (tx: never) => Promise<T>): Promise<T> {
        calls += 1;
        if (calls === 2) {
          throw new Error('simulated per-row failure');
        }
        return work(undefined as never);
      },
    };

    const sweepSlaTracking = createSweepSlaTrackingUseCase({
      cases,
      slaTracking,
      notificationSender,
      unitOfWork: flakyUnitOfWork,
      clock: new FixedClock(NOW),
    });

    await expect(sweepSlaTracking()).rejects.toThrow('simulated per-row failure');

    const ok = await slaTracking.findByCaseId(createCaseId(oid('case-ok')));
    expect(ok?.status).toBe('WARNING');
  });
});
