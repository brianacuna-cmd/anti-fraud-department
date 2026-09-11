import { createHash } from 'node:crypto';
import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { ActorType } from '../domain/model/ActorType.js';
import type { AuditLog } from '../domain/model/aggregates/AuditLog.js';
import type { AuditLogFilter, AuditLogReader } from '../domain/ports/AuditLogQuery.js';
import type { AuditLogRepository } from '../domain/ports/AuditLogRepository.js';
import type { TrailSigner, TrailSignature } from '../domain/ports/TrailSigner.js';
import { AuditLog as AuditLogAggregate } from '../domain/model/aggregates/AuditLog.js';
import type { AuditLogId } from '../domain/model/value-objects/AuditLogId.js';
import { signingUnavailable } from '../domain/errors/AuditError.js';
import { auditScopeFor, requireAuditReader } from './authorization/policy.js';

export type ExportFormat = 'csv' | 'json';

export interface ExportAuditTrailInput {
  readonly auth: AuthContext;
  readonly format: ExportFormat;
  readonly actorId?: string;
  readonly actorType?: ActorType;
  readonly action?: string;
  readonly resource?: string;
  readonly from?: Instant;
  readonly to?: Instant;
}

export interface ExportedTrail {
  readonly body: Buffer;
  readonly contentType: string;
  readonly filename: string;
  readonly rowCount: number;
  /** SHA-256 del cuerpo, hex. Va también en el manifiesto. */
  readonly sha256: string;
  readonly signature: TrailSignature;
}

export interface ExportAuditTrailDeps {
  readonly reader: AuditLogReader;
  readonly repository: AuditLogRepository;
  readonly signer: TrailSigner;
  readonly clock: Clock;
  readonly generateAuditLogId: () => AuditLogId;
}

const CSV_COLUMNS = [
  'created_at',
  'organization_id',
  'actor_type',
  'actor_id',
  'action',
  'resource',
  'resource_id',
  'ip_address',
  'detail',
] as const;

/** Escapa un campo CSV según RFC 4180. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toRow(log: AuditLog): readonly unknown[] {
  return [
    log.createdAt,
    log.organizationId,
    log.actorType,
    log.actorId,
    log.action,
    log.resource,
    log.resourceId,
    log.ipAddress,
    JSON.stringify(log.detail),
  ];
}

/**
 * AUD-003: descarga firmada de la bitácora para SOC 2 / ISO 27001 / Vanta.
 *
 * SE FIRMA O NO SE ENTREGA
 *
 * Si no hay clave configurada, esto FALLA en vez de devolver el fichero sin
 * firmar. Es la decisión más importante del caso de uso: un volcado de
 * auditoría sin firma tiene exactamente el mismo aspecto que uno firmado —una
 * lista de filas— y quien lo recibe no tiene forma de notar la diferencia
 * hasta que intenta verificarlo, normalmente delante del auditor. Degradar en
 * silencio aquí es prometer una garantía que no se está dando.
 *
 * LA EXPORTACIÓN SÍ SE AUDITA
 *
 * Consultar la bitácora no deja rastro —haría que creciera por leerla— pero
 * exportarla sí: en ese momento el registro sale del sistema y deja de estar
 * bajo su control. La fila que se escribe lleva el hash del fichero, así que
 * más adelante se puede demostrar si una copia que aparece por ahí es la que
 * se emitió o no.
 */
export function createExportAuditTrailUseCase(deps: ExportAuditTrailDeps) {
  return async function exportAuditTrail(input: ExportAuditTrailInput): Promise<ExportedTrail> {
    requireAuditReader(input.auth);
    const organizationId = auditScopeFor(input.auth);

    const filter: AuditLogFilter = {
      organizationId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: input.action,
      resource: input.resource,
      from: input.from,
      to: input.to,
    };

    const chunks: string[] = [];
    let rowCount = 0;

    if (input.format === 'csv') {
      chunks.push(CSV_COLUMNS.join(','));
      for await (const log of deps.reader.stream(filter)) {
        chunks.push(toRow(log).map(csvCell).join(','));
        rowCount += 1;
      }
      // Salto final: sin él, la última linea queda sin terminar y algunas
      // herramientas de auditoria la descartan al importar.
      chunks.push('');
    } else {
      /*
       * JSON Lines, no un array JSON.
       *
       * Un array obliga a tener el documento entero bien formado para poder
       * leer la primera fila, y a construirlo entero en memoria para emitirlo.
       * Una fila por línea se transmite, se corta y se verifica por partes —y
       * sigue siendo trivial de cargar en cualquier herramienta.
       */
      for await (const log of deps.reader.stream(filter)) {
        chunks.push(JSON.stringify(log.toProps()));
        rowCount += 1;
      }
      chunks.push('');
    }

    const body = Buffer.from(chunks.join('\n'), 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');

    const signature = deps.signer.sign(body);
    if (signature === null) {
      throw signingUnavailable();
    }

    const now = deps.clock.now();

    await deps.repository.save(
      AuditLogAggregate.create({
        id: deps.generateAuditLogId(),
        organizationId,
        actorType: input.auth.actorType,
        actorId: input.auth.userId,
        action: 'EXPORT_AUDIT_TRAIL',
        resource: 'audit_log',
        resourceId: null,
        detail: {
          format: input.format,
          rowCount,
          // El hash es lo que convierte esta fila en una prueba: con él se
          // puede decir si un fichero que aparece meses despues es este.
          sha256,
          bytes: body.byteLength,
          filter: { actorId: input.actorId, action: input.action, from: input.from, to: input.to },
        },
        ipAddress: input.auth.ipAddress,
        createdAt: now,
      }),
    );

    return {
      body,
      contentType: input.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
      filename: `audit-trail-${now.slice(0, 10)}.${input.format === 'csv' ? 'csv' : 'jsonl'}`,
      rowCount,
      sha256,
      signature,
    };
  };
}
