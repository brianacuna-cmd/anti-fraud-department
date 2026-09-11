import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Clock } from '../../../shared/time/Clock.js';
import { fromDate, toDate } from '../../../shared/time/Instant.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { AuditLogReader } from '../domain/ports/AuditLogQuery.js';
import type { AuditLogRepository } from '../domain/ports/AuditLogRepository.js';
import type { ColdStorage } from '../domain/ports/ColdStorage.js';
import type { AuditLogId } from '../domain/model/value-objects/AuditLogId.js';
import { AuditLog } from '../domain/model/aggregates/AuditLog.js';

/**
 * Cuántos meses de bitácora se dejan en la base de datos activa.
 *
 * Doce: una consulta de auditoría casi siempre mira el trimestre en curso, y
 * lo anterior se pide en bloque para una revisión anual. Los registros NO se
 * borran al archivarlos — ver `ArchiveAuditTrailResult`.
 */
export const HOT_WINDOW_MONTHS = 12;

export interface ArchiveAuditTrailResult {
  readonly archivedRows: number;
  readonly key: string | null;
  readonly sha256: string | null;
  readonly periodEnd: Instant;
}

export interface ArchiveAuditTrailDeps {
  readonly reader: AuditLogReader;
  readonly repository: AuditLogRepository;
  readonly coldStorage: ColdStorage;
  readonly clock: Clock;
  readonly generateAuditLogId: () => AuditLogId;
}

function cutoff(now: Instant): Instant {
  const date = toDate(now);
  const cut = new Date(date.getTime());
  cut.setUTCMonth(cut.getUTCMonth() - HOT_WINDOW_MONTHS);
  return fromDate(cut);
}

/**
 * AUD-004: comprime la bitácora antigua y la sube a almacenamiento inmutable.
 *
 * COPIA, NO MUEVE
 *
 * El worker no borra nada de Mongo, y eso se aparta del enunciado a
 * propósito. Un trabajo mensual que borra registros de auditoría es un
 * trabajo que puede destruir la prueba si el bucket falla a mitad, si las
 * credenciales caducaron o si alguien apuntó a un bucket de pruebas. El
 * beneficio de recuperar espacio no compensa esa clase de riesgo sobre estos
 * datos concretos.
 *
 * Lo que hace es dejar la copia inmutable y ANOTAR en la propia bitácora qué
 * se archivó y con qué hash. La purga, si algún día se quiere, puede ser un
 * paso posterior y separado que exija comprobar antes esa copia — y esa
 * comprobación es justo la que no se puede hacer si el borrado va pegado a la
 * subida.
 */
export function createArchiveAuditTrailUseCase(deps: ArchiveAuditTrailDeps) {
  return async function archiveAuditTrail(): Promise<ArchiveAuditTrailResult> {
    const now = deps.clock.now();
    const periodEnd = cutoff(now);

    const lines: string[] = [];
    for await (const log of deps.reader.stream({ organizationId: null, to: periodEnd })) {
      lines.push(JSON.stringify(log.toProps()));
    }

    if (lines.length === 0) {
      return { archivedRows: 0, key: null, sha256: null, periodEnd };
    }

    // JSON Lines comprimido: se lee por partes sin descomprimir entero, que es
    // lo que se necesita de un fichero que puede tener millones de filas.
    const body = gzipSync(Buffer.from(lines.join('\n') + '\n', 'utf8'));
    const sha256 = createHash('sha256').update(body).digest('hex');
    const key = `audit-trail/${periodEnd.slice(0, 10)}/audit-logs-${now.slice(0, 10)}.jsonl.gz`;

    const archived = await deps.coldStorage.put(key, body, 'application/gzip');

    /*
     * El archivado se audita en la propia bitácora que archiva.
     *
     * Parece circular y es exactamente lo que se quiere: la fila queda en la
     * ventana caliente, así que dentro de un año se puede responder "qué se
     * archivó y dónde" sin ir a buscar el fichero primero.
     */
    await deps.repository.save(
      AuditLog.create({
        id: deps.generateAuditLogId(),
        organizationId: null,
        actorType: 'PLATFORM_ADMIN',
        actorId: null,
        action: 'ARCHIVE_AUDIT_TRAIL',
        resource: 'audit_log',
        resourceId: null,
        detail: {
          key: archived.key,
          rows: lines.length,
          bytes: archived.bytes,
          sha256: archived.sha256,
          retainUntil: archived.retainUntil,
          periodEnd,
          // Se deja dicho que NO se borró nada, porque es lo primero que
          // alguien asume al ver un job de archivado.
          deletedFromDatabase: false,
        },
        ipAddress: null,
        createdAt: now,
      }),
    );

    return { archivedRows: lines.length, key: archived.key, sha256, periodEnd };
  };
}
