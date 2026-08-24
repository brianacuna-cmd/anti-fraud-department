import type { Transaction, UnitOfWork } from '../domain/ports/UnitOfWork.js';

/**
 * `UnitOfWork` for unit tests and single-write paths — runs `work` directly
 * against an opaque handle, no real Mongo session (mirrors identity-access).
 */
export class PassthroughUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(this.fakeTransaction);
  }
}
