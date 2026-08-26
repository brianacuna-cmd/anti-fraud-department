import { oid } from '../../../support/oid.js';
import { createGetDlqEventUseCase } from '../../../../src/modules/case-management/application/GetDlqEvent.js';
import { InMemoryOutboxDlqRepository } from '../../../helpers/case-management/InMemoryOutboxDlqRepository.js';
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
    payload: { caseId: `case-${id}`, amount: 100 },
    publishAttempts: 5,
    reason: 'connection timeout',
    createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')),
    exhaustedAt: fromDate(new Date('2026-06-01T12:00:00.000Z')),
  });
}

describe('createGetDlqEventUseCase', () => {
  // --- 2.1 Authorization ---

  it('throws FORBIDDEN_CROSS_TENANT for a USER actor', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    const getDlqEvent = createGetDlqEventUseCase({ dlq });

    await expect(
      getDlqEvent({ auth: USER_ORG1, dlqEventId: oid('e1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  // --- 2.4 GetDlqEvent behavior ---

  it('returns the full DLQ event including payload and reason (error_trace source)', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    const getDlqEvent = createGetDlqEventUseCase({ dlq });

    const event = await getDlqEvent({ auth: ADMIN, dlqEventId: oid('e1') });

    expect(event.id).toBe(createOutboxEventId(oid('e1')));
    expect(event.payload).toEqual({ caseId: 'case-e1', amount: 100 });
    expect(event.reason).toBe('connection timeout');
    expect(event.organizationId).toBe(oid('org-1'));
  });

  it('throws DLQ_EVENT_NOT_FOUND when no row exists for the given id', async () => {
    const getDlqEvent = createGetDlqEventUseCase({ dlq: new InMemoryOutboxDlqRepository() });

    await expect(
      getDlqEvent({ auth: ADMIN, dlqEventId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'DLQ_EVENT_NOT_FOUND' });
  });

  it('returns the event for an existing id', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1'));
    await dlq.save(dlqEvent('e2'));
    const getDlqEvent = createGetDlqEventUseCase({ dlq });

    const event = await getDlqEvent({ auth: ADMIN, dlqEventId: oid('e2') });

    expect(event.id).toBe(createOutboxEventId(oid('e2')));
  });
});
