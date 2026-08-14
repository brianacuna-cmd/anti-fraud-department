import { toDate, type Instant } from '../../../src/shared/time/Instant.js';
import type { CustomerOutgoingEvent } from '../../../src/modules/case-management/domain/model/aggregates/CustomerOutgoingEvent.js';
import type { CustomerOutgoingEventRepository } from '../../../src/modules/case-management/domain/ports/CustomerOutgoingEventRepository.js';
import type { CustomerOutgoingEventId } from '../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import type { EnforcementActionId } from '../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** Fixed backoff schedule (seconds): 1, 2, 4, 8, 16 for attempts 0..4. */
const BACKOFF_SECONDS = [1, 2, 4, 8, 16] as const;

function isDue(event: CustomerOutgoingEvent, now: Instant): boolean {
  if (event.status !== 'PENDING' || event.attempts >= 5) {
    return false;
  }
  if (event.lastAttemptAt === null) {
    return true;
  }
  const delaySeconds = BACKOFF_SECONDS[Math.min(event.attempts, BACKOFF_SECONDS.length - 1)] ?? 16;
  const dueAtMs = toDate(event.lastAttemptAt).getTime() + delaySeconds * 1000;
  return toDate(now).getTime() >= dueAtMs;
}

export class InMemoryCustomerOutgoingEventRepository implements CustomerOutgoingEventRepository {
  private readonly byId = new Map<string, CustomerOutgoingEvent>();

  async save(event: CustomerOutgoingEvent, _tx?: Transaction): Promise<void> {
    this.byId.set(event.id, event);
  }

  async findById(id: CustomerOutgoingEventId, _tx?: Transaction): Promise<CustomerOutgoingEvent | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEnforcementActionId(
    enforcementActionId: EnforcementActionId,
    _tx?: Transaction,
  ): Promise<CustomerOutgoingEvent | null> {
    return (
      [...this.byId.values()].find((event) => event.enforcementActionId === enforcementActionId) ?? null
    );
  }

  async claimPending(now: Instant, limit: number, _tx?: Transaction): Promise<CustomerOutgoingEvent[]> {
    return [...this.byId.values()]
      .filter((event) => isDue(event, now))
      .sort((a, b) => toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime())
      .slice(0, limit);
  }

  all(): readonly CustomerOutgoingEvent[] {
    return [...this.byId.values()];
  }
}
