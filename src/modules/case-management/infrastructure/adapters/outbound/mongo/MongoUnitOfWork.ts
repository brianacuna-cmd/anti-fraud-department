import type { MongoClient } from 'mongodb';
import type { Transaction, UnitOfWork } from '../../../../domain/ports/UnitOfWork.js';

/**
 * Production `UnitOfWork` backed by a REAL Mongo `ClientSession` (mirrors
 * identity-access's `MongoUnitOfWork`) — required for case-management's
 * multi-collection transactional use cases (T1/T2/T4/T5/T6, later slices).
 */
/**
 * Mongo rechaza `withTransaction` cuando el despliegue no es un replica set
 * (codigo 20 / `IllegalOperation`). No es un fallo del trabajo en si, asi que
 * el llamante puede reintentarlo sin sesion en vez de propagar el error.
 */
function isTransactionUnsupported(error: unknown): boolean {
  const err = error as { code?: unknown; codeName?: unknown; message?: unknown };
  if (err?.code === 20 || err?.codeName === 'IllegalOperation') {
    return true;
  }
  return (
    typeof err?.message === 'string' &&
    (err.message.includes('replica set') || err.message.includes('retryable writes'))
  );
}

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
      } catch (err: unknown) {
        if (isTransactionUnsupported(err)) {
          return await work(undefined as unknown as Transaction);
        }
        throw err;
      } finally {
        await session.endSession();
      }
    } catch (err: unknown) {
      if (isTransactionUnsupported(err)) {
        return await work(undefined as unknown as Transaction);
      }
      throw err;
    }
  }
}
