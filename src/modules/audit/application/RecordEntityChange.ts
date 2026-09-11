import type { Clock } from '../../../shared/time/Clock.js';
import type { ActorType } from '../domain/model/ActorType.js';
import { EntityChange } from '../domain/model/aggregates/EntityChange.js';
import type { AuditLogId } from '../domain/model/value-objects/AuditLogId.js';
import type { EntityChangeRepository } from '../domain/ports/EntityChangeRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import { diffFields } from '../domain/services/diffFields.js';

export interface RecordEntityChangeInput {
  readonly organizationId: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  /** Documento tal como estaba. `null` en un alta. */
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>>;
}

export interface RecordEntityChangeDeps {
  readonly changes: EntityChangeRepository;
  readonly clock: Clock;
  readonly generateAuditLogId: () => AuditLogId;
}

/**
 * AUD-001: calcula el diff y guarda una fila por escritura, si hubo cambio.
 *
 * SIN CAMBIOS NO SE ESCRIBE NADA, y es lo que hace la colección utilizable.
 * Muchas escrituras guardan un documento idéntico —un reintento, un guardado
 * defensivo, un sync que no trajo novedades—. Registrar cada una llenaría
 * `entity_change_log` de filas con la lista de mutaciones vacía, y quien
 * buscara cuándo cambió un campo tendría que cribarlas a mano.
 */
export function createRecordEntityChangeUseCase(deps: RecordEntityChangeDeps) {
  return async function recordEntityChange(
    input: RecordEntityChangeInput,
    tx?: Transaction,
  ): Promise<void> {
    const mutations = diffFields(input.before, input.after);
    if (mutations.length === 0) return;

    await deps.changes.save(
      EntityChange.create({
        id: deps.generateAuditLogId(),
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        actorType: input.actorType,
        actorId: input.actorId,
        mutations,
        createdAt: deps.clock.now(),
      }),
      tx,
    );
  };
}
