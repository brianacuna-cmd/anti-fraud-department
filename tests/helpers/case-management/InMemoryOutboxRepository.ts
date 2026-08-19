import type { OutboxEvent } from '../../../src/modules/case-management/domain/model/aggregates/OutboxEvent.js';
import type { OutboxRepository } from '../../../src/modules/case-management/domain/ports/OutboxRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory fake for `OutboxRepository`, preserving insertion order. */
export class InMemoryOutboxRepository implements OutboxRepository {
  private readonly events: OutboxEvent[] = [];

  async record(event: OutboxEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }

  async findPending(limit = 100, _tx?: Transaction): Promise<readonly OutboxEvent[]> {
    return this.events.filter((event) => event.status === 'PENDING').slice(0, limit);
  }

  /** Reemplaza por id, igual que el upsert del adaptador de Mongo. */
  async save(event: OutboxEvent, _tx?: Transaction): Promise<void> {
    const index = this.events.findIndex((candidate) => candidate.id === event.id);
    if (index >= 0) this.events[index] = event;
    else this.events.push(event);
  }

  /** Test-only accessor. */
  all(): readonly OutboxEvent[] {
    return this.events;
  }
}
