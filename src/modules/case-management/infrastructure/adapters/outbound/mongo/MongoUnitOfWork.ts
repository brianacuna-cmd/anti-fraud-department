import type { MongoClient } from 'mongodb';
import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (mirrors
 * identity-access's `MongoUnitOfWork`) — required for case-management's
 * multi-collection transactional use cases (T1/T2/T4/T5/T6, later slices).
 */
export class MongoUnitOfWork implements UnitOfWork {
  constructor(private readonly client: MongoClient) {}

  async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      const session = this.client.startSession();
      try {
        let result: T;
        await session.withTransaction(async () => {
          result = await work(session as unknown as Transaction);
        });
        return result!;
      } catch (err: any) {
        if (
          err?.code === 20 ||
          err?.codeName === 'IllegalOperation' ||
          err?.message?.includes('replica set') ||
          err?.message?.includes('retryable writes')
        ) {
          return await work(undefined as unknown as Transaction);
        }
        throw err;
      } finally {
        await session.endSession();
      }
    } catch (err: any) {
      if (
        err?.code === 20 ||
        err?.codeName === 'IllegalOperation' ||
        err?.message?.includes('replica set') ||
        err?.message?.includes('retryable writes')
      ) {
        return await work(undefined as unknown as Transaction);
      }
      throw err;
    }
  }
}
