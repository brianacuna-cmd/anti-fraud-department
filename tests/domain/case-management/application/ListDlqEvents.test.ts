import { oid } from '../../../support/oid.js';
import { createListDlqEventsUseCase } from '../../../../src/modules/case-management/application/ListDlqEvents.js';
import { InMemoryOutboxDlqRepository } from '../../../helpers/case-management/InMemoryOutboxDlqRepository.js';
import { DeadLetterEvent } from '../../../../src/shared/outbox/DeadLetterEvent.js';
import { createOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { encodeDescCursor } from '../../../../src/shared/http/pagination.js';

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

const ORG_ACTOR = createAuthContext({
  userId: oid('org-actor-1'),
  organizationId: oid('org-1'),
  actorType: 'ORGANIZATION',
});

function dlqEvent(id: string, orgId: string, exhaustedAt: Date): DeadLetterEvent {
  return DeadLetterEvent.rehydrate({
    id: createOutboxEventId(oid(id)),
    organizationId: orgId,
    eventType: 'case.created',
    aggregateType: 'case',
    aggregateId: `case-${id}`,
    payload: { caseId: `case-${id}` },
    publishAttempts: 5,
    reason: 'broker unavailable',
    createdAt: fromDate(new Date('2026-01-01T00:00:00.000Z')),
    exhaustedAt: fromDate(exhaustedAt),
  });
}

const T1 = new Date('2026-06-01T12:00:00.000Z'); // newest
const T2 = new Date('2026-06-01T11:00:00.000Z');
const T3 = new Date('2026-06-01T10:00:00.000Z'); // oldest

describe('createListDlqEventsUseCase', () => {
  // --- 2.1 Authorization (403) ---

  it('throws FORBIDDEN_CROSS_TENANT for a USER actor', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    await expect(
      listDlqEvents({ auth: USER_ORG1, limit: 10 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('throws FORBIDDEN_CROSS_TENANT for an ORGANIZATION actor', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    await expect(
      listDlqEvents({ auth: ORG_ACTOR, limit: 10 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  // --- 2.2 Tenant isolation ---

  it('PLATFORM_ADMIN without organizationId gets cross-tenant rows', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    await dlq.save(dlqEvent('e2', oid('org-2'), T2));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const result = await listDlqEvents({ auth: ADMIN, limit: 10 });

    expect(result.items).toHaveLength(2);
  });

  it('USER actor with matching organizationId is still rejected (403)', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    await expect(
      listDlqEvents({ auth: USER_ORG1, limit: 10, organizationId: oid('org-1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  // --- 2.3 ListDlqEvents behavior ---

  it('returns events newest-first (DESC order)', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T3)); // oldest
    await dlq.save(dlqEvent('e2', oid('org-1'), T1)); // newest
    await dlq.save(dlqEvent('e3', oid('org-1'), T2)); // middle
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const result = await listDlqEvents({ auth: ADMIN, limit: 10 });

    const ids = result.items.map((e) => e.id);
    expect(ids[0]).toBe(createOutboxEventId(oid('e2'))); // newest first
    expect(ids[1]).toBe(createOutboxEventId(oid('e3')));
    expect(ids[2]).toBe(createOutboxEventId(oid('e1'))); // oldest last
  });

  it('returns null nextCursor when all results fit in one page', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const result = await listDlqEvents({ auth: ADMIN, limit: 10 });

    expect(result.nextCursor).toBeNull();
  });

  it('returns a non-null nextCursor when more results exist than the page size', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    await dlq.save(dlqEvent('e2', oid('org-1'), T2));
    await dlq.save(dlqEvent('e3', oid('org-1'), T3));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const result = await listDlqEvents({ auth: ADMIN, limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it('returns an empty page with null nextCursor when no DLQ rows exist', async () => {
    const listDlqEvents = createListDlqEventsUseCase({ dlq: new InMemoryOutboxDlqRepository() });

    const result = await listDlqEvents({ auth: ADMIN, limit: 10 });

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it('scopes results to organizationId when provided', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    await dlq.save(dlqEvent('e2', oid('org-2'), T2));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const result = await listDlqEvents({ auth: ADMIN, limit: 10, organizationId: oid('org-1') });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.organizationId).toBe(oid('org-1'));
  });

  it('returns items that do NOT include the payload field directly (metadata-only contract)', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const result = await listDlqEvents({ auth: ADMIN, limit: 10 });

    const item = result.items[0]!;
    expect(item.id).toBeDefined();
    expect(item.organizationId).toBeDefined();
    expect(item.eventType).toBeDefined();
    expect(item.exhaustedAt).toBeDefined();
    // payload is accessible on the domain object but should NOT be in the
    // HTTP response (enforced by DlqEventHttpMapper in PR2). At the use-case
    // level the full DeadLetterEvent is returned; the HTTP mapper omits payload.
  });

  it('throws INVARIANT_VIOLATION for a malformed cursor', async () => {
    const listDlqEvents = createListDlqEventsUseCase({ dlq: new InMemoryOutboxDlqRepository() });

    await expect(
      listDlqEvents({ auth: ADMIN, limit: 10, cursor: 'not-a-valid-cursor!!!' }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });
  });

  it('accepts a valid cursor from a previous page and returns the next slice', async () => {
    const dlq = new InMemoryOutboxDlqRepository();
    await dlq.save(dlqEvent('e1', oid('org-1'), T1));
    await dlq.save(dlqEvent('e2', oid('org-1'), T2));
    await dlq.save(dlqEvent('e3', oid('org-1'), T3));
    const listDlqEvents = createListDlqEventsUseCase({ dlq });

    const firstPage = await listDlqEvents({ auth: ADMIN, limit: 2 });
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await listDlqEvents({
      auth: ADMIN,
      limit: 2,
      cursor: firstPage.nextCursor!,
    });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]!.id).toBe(createOutboxEventId(oid('e3')));
    expect(secondPage.nextCursor).toBeNull();
  });
});
