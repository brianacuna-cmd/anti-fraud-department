import { oid } from '../../../support/oid.js';
import { createRequeueDlqEventUseCase } from '../../../../src/modules/case-management/application/RequeueDlqEvent.js';
import { InMemoryOutboxDlqRepository } from '../../../helpers/case-management/InMemoryOutboxDlqRepository.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import {
  InMemoryUnitOfWork,
} from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { DeadLetterEvent } from '../../../../src/shared/outbox/DeadLetterEvent.js';
import { createOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: null,
  actorType: 'PLATFORM_ADMIN',
});

const USER_ORG1 = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

function dlqEvent(id: string, orgId = oid('org-1')): DeadLetterEvent {
  return DeadLetterEvent.rehydrate({
    id: createOutboxEventId(oid(id)),
    organizationId: orgId,
    eventType: 'case.created',
    aggregateType: 'case',
    aggregateId: `case-${id}`,
    payload: { caseId: `case-${id}` },
    publishAttempts: 5,
    reason: 'broker down',
    createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')),
    exhaustedAt: fromDate(new Date('2026-06-01T12:00:00.000Z')),
  });
}

interface BuildDeps {
  dlq?: InMemoryOutboxDlqRepository;
  outbox?: InMemoryOutboxEventRepository;
  unitOfWork?: InMemoryUnitOfWork;
  auditRecorder?: InMemoryCaseManagementAuditRecorder;
}

function build(overrides: BuildDeps = {}) {
  const dlq = overrides.dlq ?? new InMemoryOutboxDlqRepository();
  const outbox = overrides.outbox ?? new InMemoryOutboxEventRepository();
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const auditRecorder = overrides.auditRecorder ?? new InMemoryCaseManagementAuditRecorder();
  return {
    dlq,
    outbox,
    unitOfWork,
    auditRecorder,
    requeuDlqEvent: createRequeueDlqEventUseCase({ dlq, outbox, unitOfWork, auditRecorder }),
  };
}

describe('createRequeueDlqEventUseCase', () => {
  // --- 2.1 Authorization ---

  it('throws FORBIDDEN_CROSS_TENANT for a USER actor before any repository call', async () => {
    const { requeuDlqEvent, dlq } = build();
    await dlq.save(dlqEvent('e1'));

    await expect(
      requeuDlqEvent({ auth: USER_ORG1, dlqEventId: oid('e1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });

    // No outbox event inserted
    expect((build().outbox).all()).toHaveLength(0);
  });

  // --- 2.5 RequeueDlqEvent behavior ---

  it('deletes the DLQ row after a successful requeue', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    const { requeuDlqEvent } = build({ dlq });

    await requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    expect(dlq.all()).toHaveLength(0);
  });

  it('inserts a new PENDING outbox event with a fresh id after requeue', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    const outbox = new InMemoryOutboxEventRepository();
    const { requeuDlqEvent } = build({ dlq, outbox });

    await requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    const inserted = outbox.all();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.status).toBe('PENDING');
    expect(inserted[0]!.publishAttempts).toBe(0);
    expect(inserted[0]!.id).not.toBe(createOutboxEventId(oid('e1'))); // fresh id
  });

  it('preserves original organizationId, eventType, aggregateType, aggregateId, payload', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-42')));
    const outbox = new InMemoryOutboxEventRepository();
    const { requeuDlqEvent } = build({ dlq, outbox });

    await requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    const requeued = outbox.all()[0]!;
    expect(requeued.organizationId).toBe(oid('org-42'));
    expect(requeued.eventType).toBe('case.created');
    expect(requeued.aggregateType).toBe('case');
    expect(requeued.aggregateId).toBe('case-e1');
    expect(requeued.payload).toEqual({ caseId: 'case-e1' });
  });

  it('runs delete + insert inside a single unit-of-work transaction', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    const unitOfWork = new InMemoryUnitOfWork();
    const { requeuDlqEvent } = build({ dlq, unitOfWork });

    await requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    expect(unitOfWork.transactionCount).toBe(1);
  });

  it('emits a DLQ_REQUEUED audit entry with originalDlqId and newOutboxId', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    const auditRecorder = new InMemoryCaseManagementAuditRecorder();
    const outbox = new InMemoryOutboxEventRepository();
    const { requeuDlqEvent } = build({ dlq, auditRecorder, outbox });

    await requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    const auditEvent = events[0]!;
    expect(auditEvent.action).toBe('DLQ_REQUEUED');
    expect(auditEvent.resource).toBe('dlq_event');
    expect(auditEvent.detail).toMatchObject({
      originalDlqId: createOutboxEventId(oid('e1')),
      newOutboxId: outbox.all()[0]!.id,
    });
  });

  // --- 2.6 Edge cases ---

  it('throws DLQ_EVENT_NOT_FOUND when the given id does not exist', async () => {
    const { requeuDlqEvent } = build();

    await expect(
      requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'DLQ_EVENT_NOT_FOUND' });
  });

  it('throws DLQ_EVENT_NOT_FOUND on a duplicate requeue (row already deleted)', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    const { requeuDlqEvent } = build({ dlq });

    await requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    await expect(
      requeuDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') }),
    ).rejects.toMatchObject({ code: 'DLQ_EVENT_NOT_FOUND' });
  });
});
