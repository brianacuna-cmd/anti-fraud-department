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
    try {
      const session = this.client.startSession();
      try {
        let result: T;
        await session.withTransaction(async () => {
          result = await work(session as unknown as TTransaction);
        });
        return result!;
      } catch (error: unknown) {
        return await this.fallbackIfUnsupported(error, work);
      } finally {
        await session.endSession();
      }
    } catch (error: unknown) {
      return await this.fallbackIfUnsupported(error, work);
    }
  }

  /**
   * Mongo rejects `withTransaction` when the deployment is not a replica set
   * (code 20 / `IllegalOperation`). The work itself has not failed, so we
   * retry without a session instead of killing the request.
   *
   * WHY WARN INSTEAD OF DOING IT SILENTLY
   *
   * This path turns atomicity off. The outbox is no longer written in the
   * same transaction as the data, and a request that fails halfway can leave
   * the case changed without its event, or the other way around. The system
   * stays up, which is what we want in development, but in production it is
   * a loss of guarantees nobody should discover three months later while
   * investigating missing events: if it happens, it has to show up in the log.
   */
  private async fallbackIfUnsupported<T>(
    error: unknown,
    work: (tx: TTransaction) => Promise<T>,
  ): Promise<T> {
    if (!isTransactionUnsupported(error)) {
      throw error;
    }
    console.warn(
      '[MongoUnitOfWork] el despliegue no admite transacciones (¿Mongo sin replica set?); ' +
        'la operacion se ejecuta SIN atomicidad — el outbox puede quedar descuadrado',
    );
    return work(undefined as unknown as TTransaction);
  }
}

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
