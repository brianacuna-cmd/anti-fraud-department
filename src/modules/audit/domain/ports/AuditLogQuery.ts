import type { Instant } from '../../../../shared/time/Instant.js';
import type { AuditLog } from '../model/aggregates/AuditLog.js';
import type { ActorType } from '../model/ActorType.js';

/**
 * Filtros de la consulta central de auditoría (AUD-002).
 *
 * `organizationId` NO es opcional a la ligera: solo un PLATFORM_ADMIN puede
 * pasarlo a `null` para ver toda la plataforma. Para cualquier otro actor lo
 * fija el caso de uso desde la sesión, nunca la petición — si viniera del
 * cliente, bastaría cambiar un parámetro para leer la auditoría de otro
 * inquilino, que es exactamente el dato que más protege un multicliente.
 */
export interface AuditLogFilter {
  readonly organizationId: string | null;
  readonly actorId?: string;
  readonly actorType?: ActorType;
  readonly action?: string;
  readonly resource?: string;
  readonly resourceId?: string;
  readonly ipAddress?: string;
  readonly from?: Instant;
  readonly to?: Instant;
}

export interface AuditLogPageQuery extends AuditLogFilter {
  readonly limit: number;
  readonly offset: number;
}

export interface AuditLogPage {
  readonly items: readonly AuditLog[];
  readonly total: number;
}

/**
 * Lado de LECTURA de la auditoría, en su propio puerto.
 *
 * Vive aparte de `AuditLogRepository` a propósito. Ese puerto se declaró
 * append-only —solo `save`, sin update ni delete— y esa restricción es lo que
 * hace creíble la bitácora. Añadirle métodos de consulta convertiría el puerto
 * que garantiza "aquí solo se escribe" en uno de propósito general, y la
 * garantía se perdería en la firma.
 */
export interface AuditLogReader {
  page(query: AuditLogPageQuery): Promise<AuditLogPage>;

  /**
   * Recorre TODAS las coincidencias, sin paginar, para el export firmado.
   *
   * Devuelve un iterador y no un array: un export de auditoría cubre meses y
   * puede ser de cientos de miles de filas, y cargarlas en memoria para
   * serializarlas after es cómo se tumba el proceso justo cuando un auditor
   * pide el fichero.
   */
  stream(filter: AuditLogFilter): AsyncIterable<AuditLog>;
}
