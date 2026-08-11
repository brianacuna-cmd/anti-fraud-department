import type {
  Transaction,
  UnitOfWork,
} from '../../../src/modules/notifications/domain/ports/UnitOfWork.js';

/**
 * Fake `UnitOfWork` for domain/application unit tests (modeled on
 * identity-access's `InMemoryUnitOfWork`). Runs `work` immediately against
 * an opaque fake transaction handle — no real Mongo session. `forceFailure`
 * lets a test simulate a mid-transaction failure (structural atomicity
 * contract — real rollback is covered in PR3's integration test).
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;
  transactionCount = 0;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this.fakeTransaction);
  }
}
