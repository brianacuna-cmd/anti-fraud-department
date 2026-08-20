import type { MongoClient } from 'mongodb';
import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (clone of
 * case-management's `MongoUnitOfWork`) — required for atomic activate swap.
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
