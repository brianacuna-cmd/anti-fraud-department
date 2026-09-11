import { ObjectId, type Db } from 'mongodb';
import type { Case } from '../modules/case-management/domain/model/aggregates/Case.js';
import type { CaseRepository } from '../modules/case-management/domain/ports/CaseRepository.js';
import type { Transaction } from '../modules/case-management/domain/ports/UnitOfWork.js';
import type { createRecordEntityChangeUseCase } from '../modules/audit/application/RecordEntityChange.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';
import type { AuthContext } from '../shared/kernel/AuthContext.js';

/**
 * Decora `CaseRepository` para registrar quién cambió qué campo (AUD-001).
 *
 * POR QUÉ UN DECORADOR Y NO UN MÉTODO EN EL AGREGADO
 *
 * El enunciado pide un interceptor "automático". La tentación es añadir un
 * `trackChanges()` al caso de uso, y eso convierte la auditoría en algo que
 * hay que acordarse de llamar: los treinta sitios que guardan un expediente
 * tendrían que invocarlo, y el que se olvide no fallará —simplemente dejará de
 * auditar, en silencio—. Envolviendo el repositorio, la única puerta por la
 * que un expediente llega a Mongo pasa por aquí.
 *
 * Se lee el documento ANTERIOR antes de guardar, que cuesta una consulta por
 * escritura. Es el precio de poder decir qué valor tenía un campo el martes; el
 * `diff` no se puede calcular sin las dos versiones y Mongo no las guarda.
 *
 * El actor sale de un getter y no del constructor: el repositorio se construye
 * una vez al arrancar y el actor cambia en cada petición.
 */
export function createAuditedCaseRepository(
  inner: CaseRepository,
  db: Db,
  recordEntityChange: ReturnType<typeof createRecordEntityChangeUseCase>,
  currentAuth: () => AuthContext | null,
): CaseRepository {
  const collection = db.collection('cases');

  /*
   * La delegacion se escribe metodo a metodo, no con `...inner`.
   *
   * `MongoCaseRepository` es una CLASE: sus metodos viven en el prototipo, asi
   * que un spread del objeto no copia ninguno y el decorador salia con un solo
   * metodo propio, `save`. TypeScript no lo veia —`...inner` esta tipado como
   * `CaseRepository`, asi que la forma cuadraba— y el fallo aparecia en
   * ejecucion como `deps.cases.list is not a function`.
   *
   * Enumerarlos cuesta seis lineas y compra la comprobacion que faltaba: si
   * manana el puerto gana un metodo, el tipo de retorno lo exige aqui y el
   * compilador para la build en vez de dejar otro agujero silencioso.
   *
   * Cada uno va con `.bind(inner)` porque la clase guarda su coleccion en un
   * campo de instancia: una referencia suelta perderia el `this`.
   */
  return {
    findById: inner.findById.bind(inner),
    findByIdempotencyKey: inner.findByIdempotencyKey.bind(inner),
    list: inner.list.bind(inner),
    findByCustomerOrBridgeId: inner.findByCustomerOrBridgeId.bind(inner),
    findByEntityIdentifiers: inner.findByEntityIdentifiers.bind(inner),

    async save(kase: Case, tx?: Transaction): Promise<void> {
      const auth = currentAuth();
      const before = await collection.findOne(
        { _id: new ObjectId(kase.id) },
        { session: tx as never },
      );

      await inner.save(kase, tx);

      /*
       * El registro va DESPUÉS de guardar y dentro de la misma transacción.
       *
       * Antes seria registrar un cambio que puede no llegar a ocurrir si el
       * guardado falla; fuera de la transaccion seria poder perder el registro
       * de un cambio que si ocurrio. Las dos cosas rompen la bitacora en la
       * misma direccion: dejan de coincidir con la realidad.
       */
      const after = await collection.findOne(
        { _id: new ObjectId(kase.id) },
        { session: tx as never },
      );
      if (after === null) return;

      await recordEntityChange(
        {
          organizationId: kase.organizationId,
          entityType: 'case',
          entityId: kase.id,
          actorType: auth?.actorType ?? 'PLATFORM_ADMIN',
          actorId: auth?.userId ?? null,
          before: before as Record<string, unknown> | null,
          after: after as Record<string, unknown>,
        },
        tx as unknown as AuditTransaction | undefined,
      );
    },
  };
}
