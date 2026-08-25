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
   * Mongo rechaza `withTransaction` cuando el despliegue no es un replica set
   * (codigo 20 / `IllegalOperation`). El trabajo en si no ha fallado, asi que
   * se reintenta sin sesion en vez de tumbar la peticion.
   *
   * POR QUE AVISA EN VEZ DE HACERLO EN SILENCIO
   *
   * Este camino apaga la atomicidad. El outbox deja de escribirse en la misma
   * transaccion que el dato, y una peticion que falle a medias puede dejar el
   * expediente cambiado sin su evento, o al reves. El sistema sigue en pie y
   * eso es lo que se busca en desarrollo, pero en produccion es una perdida de
   * garantias que nadie deberia descubrir tres meses despues investigando por
   * que faltan eventos: si pasa, tiene que verse en el log.
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
