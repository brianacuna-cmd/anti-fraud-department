import type {
  Transaction,
  UnitOfWork,
} from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';

/**
 * Fake `UnitOfWork` for domain/application unit tests (design D6, task
 * 1.19 deferred from Phase 1 into Phase 2's domain-ports work). Runs `work`
 * immediately against an opaque fake transaction handle — no real Mongo
 * session. `forceRollback` lets a test simulate a mid-transaction failure
 * (Phase 3's atomic-bootstrap rollback tests reuse this).
 */
export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;
  transactionCount = 0;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this.fakeTransaction);
  }
}
