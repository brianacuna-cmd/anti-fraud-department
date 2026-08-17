import type { OutboxEvent } from '../model/aggregates/OutboxEvent.js';
import type { Transaction } from './UnitOfWork.js';

export interface OutboxRepository {
  record(event: OutboxEvent, tx?: Transaction): Promise<void>;
}
