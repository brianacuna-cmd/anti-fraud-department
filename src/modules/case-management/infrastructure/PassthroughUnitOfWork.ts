import type { Transaction, UnitOfWork } from '../domain/ports/UnitOfWork.js';

/**
 * `UnitOfWork` for single-aggregate case-management use cases (mirrors
 * identity-access's `PassthroughUnitOfWork`) — runs `work` directly against
 * an opaque handle, no real Mongo session.
 */
export class PassthroughUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(this.fakeTransaction);
  }
}
