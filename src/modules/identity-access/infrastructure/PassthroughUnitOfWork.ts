import type { Transaction, UnitOfWork } from '../domain/ports/UnitOfWork.js';

/**
 * Production `UnitOfWork` for Phase 2's organization use cases, which only
 * ever touch a single aggregate (already atomic as one Mongo write) — runs
 * `work` directly against an opaque handle, no real Mongo session. Phase 3's
 * `CreateOrganizationWithAdmin` (genuine cross-collection atomicity) needs a
 * real `MongoUnitOfWork` backed by `ClientSession.withTransaction`; this
 * adapter is deliberately NOT that, and must be swapped there.
 */
export class PassthroughUnitOfWork implements UnitOfWork {
  private readonly fakeTransaction = {} as Transaction;

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return work(this.fakeTransaction);
  }
}
