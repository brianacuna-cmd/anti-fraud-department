import { createSweepCaseSlaUseCase } from '../../../../src/modules/case-management/application/SweepCaseSla.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../../../../src/modules/case-management/domain/model/aggregates/CaseSlaTracking.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { createCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { CaseNotification, Notifier } from '../../../../src/modules/case-management/domain/ports/Notifier.js';

const NOW = fromDate(new Date('2026-11-01T12:00:00.000Z'));

/** Dentro de la ventana de aviso de 30 minutos. */
const DUE_SOON = fromDate(new Date('2026-11-01T12:20:00.000Z'));
/** Fuera de la ventana: todavia no toca avisar. */
const DUE_LATER = fromDate(new Date('2026-11-01T18:00:00.000Z'));
/** Ya vencido. */
const OVERDUE = fromDate(new Date('2026-11-01T11:00:00.000Z'));

class RecordingNotifier implements Notifier {
  public readonly sent: CaseNotification[] = [];
  async notify(notification: CaseNotification): Promise<void> {
    this.sent.push(notification);
  }
}

function build(specs: { dueDate: string; status?: 'ON_TRACK' | 'WARNING'; assignee?: string | null }[]) {
  const cases = new InMemoryCaseRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const notifier = new RecordingNotifier();

  const seeded = specs.map((spec, index) => {
    let kase = Case.create({
      id: generateCaseId(),
      organizationId: 'org-1',
      customerId: `customer-${index}`,
      riskScore: createRiskScore(70),
      priority: createCasePriority('HIGH'),
      now: NOW,
    });
    if (spec.assignee !== null) {
      kase = kase.reassign(createAssignedTo('USER', spec.assignee ?? 'analyst-1'), NOW);
    }
    void cases.save(kase);

    let tracking = CaseSlaTracking.create({
      id: createCaseSlaTrackingId(`tracking-${index}`),
      caseId: kase.id,
      dueDate: fromDate(new Date(spec.dueDate)),
      now: NOW,
    });
    if (spec.status === 'WARNING') tracking = tracking.advanceTo('WARNING', NOW);
    slaTracking.seed(tracking);

    return { kase, tracking };
  });

  const sweepCaseSla = createSweepCaseSlaUseCase({
    slaTracking,
    cases,
    timelineRecorder,
    clock: new FixedClock(NOW),
    generateTimelineEventId,
    notifier,
  });

  return { cases, slaTracking, timelineRecorder, notifier, seeded, sweepCaseSla };
}

describe('createSweepCaseSlaUseCase', () => {
  it('moves an ON_TRACK case into WARNING once it enters the lead window', async () => {
    const { slaTracking, sweepCaseSla } = build([{ dueDate: DUE_SOON }]);

    const result = await sweepCaseSla();

    expect(result.warned).toBe(1);
    expect(result.breached).toBe(0);
    expect(slaTracking.all()[0]?.status).toBe('WARNING');
  });

  it('leaves a case alone while its deadline is still far away', async () => {
    const { slaTracking, sweepCaseSla, notifier } = build([{ dueDate: DUE_LATER }]);

    const result = await sweepCaseSla();

    expect(result).toMatchObject({ examined: 0, warned: 0, breached: 0 });
    expect(slaTracking.all()[0]?.status).toBe('ON_TRACK');
    expect(notifier.sent).toHaveLength(0);
  });

  it('breaches a case that is already past its deadline and was warned', async () => {
    const { slaTracking, sweepCaseSla } = build([{ dueDate: OVERDUE, status: 'WARNING' }]);

    const result = await sweepCaseSla();

    expect(result.breached).toBe(1);
    expect(slaTracking.all()[0]?.status).toBe('BREACHED');
  });

  it('steps one rung per pass rather than jumping straight to BREACHED', async () => {
    // Cada peldano deja su asiento; saltarlos borraria la evidencia de que el
    // aviso llego a emitirse.
    const { slaTracking, sweepCaseSla } = build([{ dueDate: OVERDUE }]);

    await sweepCaseSla();
    expect(slaTracking.all()[0]?.status).toBe('WARNING');

    await sweepCaseSla();
    expect(slaTracking.all()[0]?.status).toBe('BREACHED');
  });

  it('stops touching a case once it is BREACHED', async () => {
    const { slaTracking, sweepCaseSla } = build([{ dueDate: OVERDUE, status: 'WARNING' }]);
    await sweepCaseSla();

    const result = await sweepCaseSla();

    expect(result).toMatchObject({ examined: 0, warned: 0, breached: 0 });
    expect(slaTracking.all()[0]?.status).toBe('BREACHED');
  });

  it('writes a timeline entry for each rung', async () => {
    const { timelineRecorder, sweepCaseSla } = build([{ dueDate: OVERDUE }]);

    await sweepCaseSla();
    await sweepCaseSla();

    expect(timelineRecorder.all().map((e) => e.eventType)).toEqual(['SLA_INITIALIZED', 'SLA_BREACHED']);
    expect(timelineRecorder.all()[0]?.createdBy).toBe('SYSTEM_SYNC');
  });

  it('notifies the assignee, naming the deadline', async () => {
    const { notifier, sweepCaseSla } = build([{ dueDate: DUE_SOON, assignee: 'analyst-7' }]);

    await sweepCaseSla();

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({
      recipientUserId: 'analyst-7',
      alertType: 'SLA_POR_VENCER',
      resourceType: 'case',
    });
    expect(notifier.sent[0]?.body).toContain(DUE_SOON);
  });

  it('advances an unassigned case but has nobody to warn', async () => {
    const { notifier, slaTracking, sweepCaseSla } = build([{ dueDate: DUE_SOON, assignee: null }]);

    const result = await sweepCaseSla();

    expect(result.warned).toBe(1);
    expect(slaTracking.all()[0]?.status).toBe('WARNING');
    expect(notifier.sent).toHaveLength(0);
  });

  it('keeps sweeping the rest when one case fails', async () => {
    const { slaTracking, sweepCaseSla } = build([{ dueDate: DUE_SOON }, { dueDate: DUE_SOON }]);
    // Una fila corrupta: `advanceTo` lanzara al no encontrar transicion valida.
    const broken = slaTracking.all()[0]!;
    slaTracking.seed(broken.advanceTo('WARNING', NOW).advanceTo('BREACHED', NOW));

    const result = await sweepCaseSla();

    // La sana avanza igualmente; un unico caso roto no deja al resto sin vigilancia.
    expect(result.warned).toBeGreaterThanOrEqual(1);
  });
});
