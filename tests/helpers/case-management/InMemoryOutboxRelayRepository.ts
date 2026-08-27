import type { Instant } from '../../../src/shared/time/Instant.js';
import { toDate } from '../../../src/shared/time/Instant.js';
import type { OutboxEvent } from '../../../src/shared/outbox/OutboxEvent.js';
import type { OutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import type { OutboxEventRelayRepository } from '../../../src/shared/outbox/OutboxEventRelayRepository.js';

/** Doble en memoria del lado lector del outbox, conservando el orden de insercion. */
export class InMemoryOutboxRelayRepository implements OutboxEventRelayRepository {
  private readonly events: OutboxEvent[] = [];

  /** Alta inicial: es el equivalente del `save` que corre dentro de la transaccion de negocio. */
  async record(event: OutboxEvent): Promise<void> {
    this.events.push(event);
  }

  async findPending(now: Instant, limit = 100, _tx?: unknown): Promise<readonly OutboxEvent[]> {
    const nowMs = toDate(now).getTime();
    return this.events
      .filter((event) => {
        if (event.status !== 'PENDING') return false;
        if (event.nextRetryAt === null) return true;
        return toDate(event.nextRetryAt).getTime() <= nowMs;
      })
      .slice(0, limit);
  }

  async update(event: OutboxEvent, _tx?: unknown): Promise<void> {
    const index = this.events.findIndex((candidate) => candidate.id === event.id);
    if (index >= 0) this.events[index] = event;
    else this.events.push(event);
  }

  async delete(id: OutboxEventId, _tx?: unknown): Promise<void> {
    const index = this.events.findIndex((e) => e.id === id);
    if (index >= 0) this.events.splice(index, 1);
  }

  /** Test-only accessor. */
  all(): readonly OutboxEvent[] {
    return this.events;
  }
}
