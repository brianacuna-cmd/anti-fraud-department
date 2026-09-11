import type { AuditLog } from '../../../../../domain/model/aggregates/AuditLog.js';

export interface AuditLogResponse {
  readonly id: string;
  readonly organizationId: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly createdAt: string;
}

/**
 * Se devuelve el registro ENTERO, `detail` incluido.
 *
 * En otras pantallas se recorta lo que sale, pero aquí recortar seria vaciar
 * el dato: el `detail` es donde vive lo que realmente pasó —qué campo cambió,
 * con qué cifras, contra qué expediente— y una auditoría sin él solo dice que
 * alguien hizo algo. Quien puede llamar a esta ruta ya es ADMIN o AUDITOR.
 */
export function toAuditLogResponse(log: AuditLog): AuditLogResponse {
  return {
    id: log.id,
    organizationId: log.organizationId,
    actorType: log.actorType,
    actorId: log.actorId,
    action: log.action,
    resource: log.resource,
    resourceId: log.resourceId,
    detail: log.detail,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt,
  };
}
