import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { ActorType } from '../domain/model/ActorType.js';
import type { AuditLogPage, AuditLogReader } from '../domain/ports/AuditLogQuery.js';
import { auditScopeFor, requireAuditReader } from './authorization/policy.js';

export interface QueryAuditLogsInput {
  readonly auth: AuthContext;
  readonly actorId?: string;
  readonly actorType?: ActorType;
  readonly action?: string;
  readonly resource?: string;
  readonly resourceId?: string;
  readonly ipAddress?: string;
  readonly from?: Instant;
  readonly to?: Instant;
  readonly limit: number;
  readonly offset: number;
}

/**
 * AUD-002: consulta filtrada de la bitácora central.
 *
 * No emite auditoría de sí misma. Parece una omisión y no lo es: registrar
 * cada lectura haría que la colección creciera por consultarla, y una bitácora
 * cuyo mayor productor de filas es leerla deja de servir para lo que existe.
 * Lo que sí se audita es el EXPORT (AUD-003), porque ahí el registro sale del
 * sistema y deja de estar bajo su control.
 */
export function createQueryAuditLogsUseCase(deps: { readonly reader: AuditLogReader }) {
  return async function queryAuditLogs(input: QueryAuditLogsInput): Promise<AuditLogPage> {
    requireAuditReader(input.auth);

    return deps.reader.page({
      organizationId: auditScopeFor(input.auth),
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      ipAddress: input.ipAddress,
      from: input.from,
      to: input.to,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
