import type { OutboxEvent } from '../../../src/shared/outbox/OutboxEvent.js';
import type { OutboxEventRelayRepository } from '../../../src/shared/outbox/OutboxEventRelayRepository.js';

/** Doble en memoria del lado lector del outbox, conservando el orden de insercion. */
export class InMemoryOutboxRelayRepository implements OutboxEventRelayRepository {
  private readonly events: OutboxEvent[] = [];

  /** Alta inicial: es el equivalente del `save` que corre dentro de la transaccion de negocio. */
  async record(event: OutboxEvent): Promise<void> {
    this.events.push(event);
  }

  async findPending(limit = 100): Promise<readonly OutboxEvent[]> {
    return this.events.filter((event) => event.status === 'PENDING').slice(0, limit);
  }

  async update(event: OutboxEvent): Promise<void> {
    const index = this.events.findIndex((candidate) => candidate.id === event.id);
    if (index >= 0) this.events[index] = event;
    else this.events.push(event);
  }

  /** Test-only accessor. */
  all(): readonly OutboxEvent[] {
    return this.events;
  }
}
