import type {
  Transaction,
  UnitOfWork,
} from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/**
 * Fake `UnitOfWork` for case-management unit tests. Runs `work` immediately
 * against an opaque fake transaction handle — no real Mongo session.
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;
  transactionCount = 0;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this.fakeTransaction);
  }
}

/**
 * `UnitOfWork` that always throws inside `withTransaction`. Used to simulate
 * a transaction start failure, so neither `dlq.save` nor `outbox.delete`
 * runs and the outbox row remains for the next sweep.
 */
export class ThrowingUnitOfWork implements UnitOfWork {
  async withTransaction<T>(_work: (tx: Transaction) => Promise<T>): Promise<T> {
    throw new Error('simulated transaction abort');
  }
}
