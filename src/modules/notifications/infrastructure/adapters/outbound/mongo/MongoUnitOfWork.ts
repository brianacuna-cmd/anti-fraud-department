import type { MongoClient } from 'mongodb';
import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (design
 * D11), copied verbatim from identity-access's own `MongoUnitOfWork` — this
 * module owns its own instance since a module may not import another
 * module's infrastructure (eslint `boundaries`). Required (not a
 * passthrough): the preference upsert row and the `AuditLogs` row must
 * commit or roll back together.
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
