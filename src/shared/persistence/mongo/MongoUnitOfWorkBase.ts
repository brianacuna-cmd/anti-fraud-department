import type { MongoClient } from 'mongodb';

/**
 * Shared base for every module's Mongo-backed `UnitOfWork`, carrying the
 * `session.startSession()` / `session.withTransaction()` / `endSession`
 * mechanics verbatim from the 4 previously duplicated implementations
 * (case-management, identity-access, notifications, risk-assessment).
 *
 * Domain ports (`Transaction`/`UnitOfWork`) stay per-module — the generic
 * `TTransaction` parameter carries each module's opaque brand, so no type
 * leaks across module boundaries.
 */
export abstract class MongoUnitOfWorkBase<TTransaction> {
  constructor(protected readonly client: MongoClient) {}

  async withTransaction<T>(work: (tx: TTransaction) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session as unknown as TTransaction);
      });
      return result!;
    } finally {
      await session.endSession();
    }
  }
}
