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
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import type { OutboxEvent } from '../../../../src/shared/outbox/OutboxEvent.js';
import type { UnitOfWork } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

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
    tracking = tracking.markNotified(tracking.status, CREATED);
  }
  return tracking;
}

function sweepDeps(overrides: {
  cases: InMemoryCaseRepository;
  slaTracking: InMemoryCaseSlaTrackingRepository;
  notificationSender: InMemoryCaseManagementNotificationSender;
  assigneeDirectory?: InMemoryAssigneeDirectory;
  unitOfWork?: UnitOfWork;
  outbox: InMemoryOutboxEventRepository;
}) {
  return {
    cases: overrides.cases,
    slaTracking: overrides.slaTracking,
    notificationSender: overrides.notificationSender,
    assigneeDirectory: overrides.assigneeDirectory ?? new InMemoryAssigneeDirectory(),
    unitOfWork: overrides.unitOfWork ?? new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    outbox: overrides.outbox,
    generateOutboxEventId,
  };
}

function buildUseCase() {
  const cases = new InMemoryCaseRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const notificationSender = new InMemoryCaseManagementNotificationSender();
  const assigneeDirectory = new InMemoryAssigneeDirectory();
  const outbox = new InMemoryOutboxEventRepository();
  const sweepSlaTracking = createSweepSlaTrackingUseCase(
    sweepDeps({ cases, slaTracking, notificationSender, assigneeDirectory, outbox }),
  );
  return { sweepSlaTracking, cases, slaTracking, notificationSender, assigneeDirectory, outbox };
}

function expectSlaHopOutbox(
  event: OutboxEvent | undefined,
  expected: {
    eventType: 'SLA_WARNING' | 'SLA_BREACHED';
    previousStatus: 'ON_TRACK' | 'WARNING';
    status: 'WARNING' | 'BREACHED';
    caseId?: string;
    trackingId?: string;
  },
) {
  expect(event).toBeDefined();
  const caseId = expected.caseId ?? oid('case-1');
  const trackingId = expected.trackingId ?? oid('tracking-1');
  expect(event!.eventType).toBe(expected.eventType);
  expect(event!.aggregateType).toBe('cases');
  expect(event!.aggregateId).toBe(caseId);
  expect(event!.organizationId).toBe(ORG_1);
  expect(event!.status).toBe('PENDING');
  expect(event!.payload).toEqual({
    case_id: caseId,
    organization_id: ORG_1,
    sla_tracking_id: trackingId,
    previous_status: expected.previousStatus,
    status: expected.status,
    due_date: PAST_DUE,
  });
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

  it('skips a formally closed (RESOLVED) case: no advance, no notification, no mark (PR4)', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(
      buildCase(oid('case-1'), assignee).transitionTo('IN_REVIEW', NOW).transitionTo('RESOLVED', NOW),
    );
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.advanced).toBe(0);
    expect(result.notified).toBe(0);
    expect(notificationSender.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('ON_TRACK');
  });

  it('skips already-BREACHED rows (never claimed by claimDueForSweep, defensive re-check)', async () => {
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

  it('sends SLA_DUE_SOON and marks the row notified on first sweep', async () => {
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
      alertType: 'SLA_DUE_SOON',
    });
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.hasNotified('WARNING')).toBe(true);
  });

  it('re-notifies when an already-notified WARNING row advances into BREACHED (PR1: per-status re-notify)', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    const warnedButStillDue = buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE, {
      status: 'WARNING',
      notified: true,
    });
    await slaTracking.save(warnedButStillDue);

    await sweepSlaTracking();

    // The row advances WARNING->BREACHED. BREACHED has not been notified yet,
    // so a fresh SLA_DUE_SOON is sent for the new status.
    expect(notificationSender.all()).toHaveLength(1);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('BREACHED');
    expect(row?.hasNotified('WARNING')).toBe(true);
    expect(row?.hasNotified('BREACHED')).toBe(true);
  });

  it('notifies no one for a ROLE-assigned case with no active members but still advances and marks notified', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    const role = createAssignedTo('ROLE', oid('role-1'));
    await cases.save(buildCase(oid('case-1'), role));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.advanced).toBe(1);
    expect(result.notified).toBe(0);
    expect(notificationSender.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.hasNotified('WARNING')).toBe(true);
  });

  it('fans out SLA_DUE_SOON to every active member of a ROLE-assigned case (PR3)', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender, assigneeDirectory } = buildUseCase();
    const role = createAssignedTo('ROLE', oid('role-1'));
    await cases.save(buildCase(oid('case-1'), role));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));
    assigneeDirectory.allowRoleRecipients(ORG_1, oid('role-1'), [oid('analyst-1'), oid('analyst-2')]);

    const result = await sweepSlaTracking();

    expect(result.notified).toBe(2);
    const recipients = notificationSender
      .all()
      .map((request) => request.recipientUserId)
      .sort();
    expect(recipients).toEqual([oid('analyst-1'), oid('analyst-2')].sort());
    expect(notificationSender.all().every((request) => request.alertType === 'SLA_DUE_SOON')).toBe(true);
  });

  it('suppresses notification for an unassigned case but still advances and marks notified', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender } = buildUseCase();
    await cases.save(buildCase(oid('case-1'), null));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.advanced).toBe(1);
    expect(notificationSender.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.hasNotified('WARNING')).toBe(true);
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

    const outbox = new InMemoryOutboxEventRepository();
    const sweepSlaTracking = createSweepSlaTrackingUseCase(
      sweepDeps({
        cases,
        slaTracking,
        notificationSender,
        unitOfWork: flakyUnitOfWork,
        outbox,
      }),
    );

    await expect(sweepSlaTracking()).rejects.toThrow('simulated per-row failure');

    const ok = await slaTracking.findByCaseId(createCaseId(oid('case-ok')));
    expect(ok?.status).toBe('WARNING');
    const failed = await slaTracking.findByCaseId(createCaseId(oid('case-fail')));
    expect(failed?.status).toBe('ON_TRACK');
    expect(outbox.all()).toHaveLength(1);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_WARNING',
      previousStatus: 'ON_TRACK',
      status: 'WARNING',
      caseId: oid('case-ok'),
      trackingId: oid('tracking-ok'),
    });
  });

  it('emits one PENDING SLA_WARNING outbox event on a successful ON_TRACK to WARNING hop', async () => {
    const { sweepSlaTracking, cases, slaTracking, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();

    expect(outbox.all()).toHaveLength(1);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_WARNING',
      previousStatus: 'ON_TRACK',
      status: 'WARNING',
    });
  });

  it('emits one PENDING SLA_BREACHED outbox event on a successful WARNING to BREACHED hop', async () => {
    const { sweepSlaTracking, cases, slaTracking, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE, { status: 'WARNING' }));

    await sweepSlaTracking();

    expect(outbox.all()).toHaveLength(1);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_BREACHED',
      previousStatus: 'WARNING',
      status: 'BREACHED',
    });
  });

  it('emits SLA_WARNING then SLA_BREACHED across two successful ticks', async () => {
    const { sweepSlaTracking, cases, slaTracking, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();
    await sweepSlaTracking();

    expect(outbox.all()).toHaveLength(2);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_WARNING',
      previousStatus: 'ON_TRACK',
      status: 'WARNING',
    });
    expectSlaHopOutbox(outbox.all()[1], {
      eventType: 'SLA_BREACHED',
      previousStatus: 'WARNING',
      status: 'BREACHED',
    });
  });

  it('inserts no outbox and does not advance when the Case is RESOLVED', async () => {
    const { sweepSlaTracking, cases, slaTracking, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(
      buildCase(oid('case-1'), assignee).transitionTo('IN_REVIEW', NOW).transitionTo('RESOLVED', NOW),
    );
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();

    expect(outbox.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('ON_TRACK');
  });

  it('inserts no outbox and does not advance when the Case is ARCHIVED', async () => {
    const { sweepSlaTracking, cases, slaTracking, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(
      buildCase(oid('case-1'), assignee)
        .transitionTo('IN_REVIEW', NOW)
        .transitionTo('RESOLVED', NOW)
        .transitionTo('ARCHIVED', NOW),
    );
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();

    expect(outbox.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('ON_TRACK');
  });

  it('inserts no additional outbox when a subsequent tick does not hop', async () => {
    const { sweepSlaTracking, cases, slaTracking, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();
    await sweepSlaTracking();
    await sweepSlaTracking();

    expect(outbox.all()).toHaveLength(2);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('BREACHED');
  });

  it('skips outbox when Case is missing but still advances tracking', async () => {
    const { sweepSlaTracking, slaTracking, outbox } = buildUseCase();
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    const result = await sweepSlaTracking();

    expect(result.advanced).toBe(1);
    expect(outbox.all()).toHaveLength(0);
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('WARNING');
  });

  it('still emits one PENDING outbox row for an unassigned hop', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender, outbox } = buildUseCase();
    await cases.save(buildCase(oid('case-1'), null));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();

    expect(notificationSender.all()).toHaveLength(0);
    expect(outbox.all()).toHaveLength(1);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_WARNING',
      previousStatus: 'ON_TRACK',
      status: 'WARNING',
    });
  });

  it('still emits one PENDING outbox row for an empty ROLE hop', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender, outbox } = buildUseCase();
    const role = createAssignedTo('ROLE', oid('role-1'));
    await cases.save(buildCase(oid('case-1'), role));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));

    await sweepSlaTracking();

    expect(notificationSender.all()).toHaveLength(0);
    expect(outbox.all()).toHaveLength(1);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_WARNING',
      previousStatus: 'ON_TRACK',
      status: 'WARNING',
    });
  });

  it('still emits one PENDING outbox row when the new status was already marked notified', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    const created = buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE);
    const alreadyNotifiedForWarning = CaseSlaTracking.rehydrate({
      ...created.toProps(),
      notifiedStatuses: new Set(['WARNING']),
    });
    await slaTracking.save(alreadyNotifiedForWarning);

    await sweepSlaTracking();

    expect(notificationSender.all()).toHaveLength(0);
    expect(outbox.all()).toHaveLength(1);
    expectSlaHopOutbox(outbox.all()[0], {
      eventType: 'SLA_WARNING',
      previousStatus: 'ON_TRACK',
      status: 'WARNING',
    });
    const row = await slaTracking.findByCaseId(createCaseId(oid('case-1')));
    expect(row?.status).toBe('WARNING');
    expect(row?.hasNotified('WARNING')).toBe(true);
  });

  it('still notifies SLA_DUE_SOON on a hop and does not mutate the Case', async () => {
    const { sweepSlaTracking, cases, slaTracking, notificationSender, outbox } = buildUseCase();
    const assignee = createAssignedTo('USER', oid('analyst-1'));
    await cases.save(buildCase(oid('case-1'), assignee));
    await slaTracking.save(buildTracking(oid('tracking-1'), oid('case-1'), PAST_DUE));
    const before = await cases.findById(createCaseId(oid('case-1')));
    const snapshot = before!.toProps();

    await sweepSlaTracking();

    expect(notificationSender.all()).toHaveLength(1);
    expect(notificationSender.all()[0]?.alertType).toBe('SLA_DUE_SOON');
    expect(outbox.all()).toHaveLength(1);
    const after = await cases.findById(createCaseId(oid('case-1')));
    expect(after?.status).toBe('OPEN');
    expect(after?.toProps()).toEqual(snapshot);
  });
});
