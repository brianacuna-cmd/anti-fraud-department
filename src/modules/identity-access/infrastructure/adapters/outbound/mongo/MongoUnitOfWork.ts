import type { MongoClient } from 'mongodb';
import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (design D6)
 * — required for `CreateOrganizationWithAdmin`'s genuine cross-collection
 * atomicity. Deliberately NOT reused from Phase 2's `PassthroughUnitOfWork`
 * (that adapter never opens a session at all, correct only for
 * single-aggregate writes).
 */
export class MongoUnitOfWork implements UnitOfWork {
  constructor(private readonly client: MongoClient) {}

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session as unknown as Transaction);
      });
      return result!;
    } finally {
      await session.endSession();
    }
  }
}
