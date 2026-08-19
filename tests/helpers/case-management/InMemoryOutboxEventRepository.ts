import type { OutboxEvent } from '../../../src/shared/outbox/OutboxEvent.js';
import type { OutboxEventRepository } from '../../../src/shared/outbox/OutboxEventRepository.js';

/** In-memory `OutboxEventRepository` fake — records inserted events in order. */
export class InMemoryOutboxEventRepository implements OutboxEventRepository {
  private readonly events: OutboxEvent[] = [];

  async save(event: OutboxEvent): Promise<void> {
    this.events.push(event);
  }

  all(): readonly OutboxEvent[] {
    return [...this.events];
  }
}
