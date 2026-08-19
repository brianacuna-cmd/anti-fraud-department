import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { toCaseListFilter, type ListCasesInput } from './ListCases.js';

/**
 * Tope duro de filas exportables. Un tenant con cientos de miles de casos
 * generaria un fichero que ni el proceso puede construir en memoria ni el
 * analista puede abrir; se corta y se avisa en la respuesta en lugar de morir
 * a mitad de la descarga.
 */
const MAX_EXPORT_ROWS = 50_000;

/** Tamano de lote para recorrer el listado por cursor. */
const PAGE_SIZE = 500;

export type ExportCasesInput = Omit<ListCasesInput, 'limit' | 'cursor'>;

export interface ExportCasesDeps {
  readonly cases: CaseRepository;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
}

export interface ExportCasesResult {
  readonly csv: string;
  readonly rowCount: number;
  /** `true` cuando se alcanzo `MAX_EXPORT_ROWS` y el fichero esta recortado. */
  readonly truncated: boolean;
  readonly filename: string;
}

const COLUMNS = [
  'id',
  'organizationId',
  'customerId',
  'customerEmail',
  'bridgeUserId',
  'bridgeWallet',
  'stripeCustomerId',
  'riskScore',
  'status',
  'priority',
  'assignedToType',
  'assignedToId',
  'tags',
  'dueDate',
  'createdAt',
  'updatedAt',
] as const;

/**
 * Neutraliza la inyeccion de formulas en hojas de calculo.
 *
 * Excel y LibreOffice interpretan como formula toda celda que empiece por
 * `=`, `+`, `-`, `@`, tabulador o retorno de carro. Como el CSV lleva datos
 * que un tercero controla —el email o el alias de un cliente, por ejemplo—,
 * un valor tipo `=HYPERLINK(...)` se ejecutaria al abrir el fichero de
 * auditoria. Anteponer un apostrofo lo obliga a leerse como texto.
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Escapado CSV segun RFC 4180: comillas dobladas y celda entrecomillada si hace falta. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = neutralizeFormula(String(value));
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toRow(kase: Case): readonly unknown[] {
  return [
    kase.id,
    kase.organizationId,
    kase.customerId,
    kase.customerEmail,
    kase.bridgeUserId,
    kase.bridgeWallet,
    kase.stripeCustomerId,
    kase.riskScore,
    kase.status,
    kase.priority,
    kase.assignedTo?.type ?? null,
    kase.assignedTo?.id ?? null,
    kase.tags.join('|'),
    kase.dueDate,
    kase.createdAt,
    kase.updatedAt,
  ];
}

/**
 * CASE-013 — descarga del listado filtrado para auditoria interna.
 *
 * Reutiliza `toCaseListFilter`, el mismo traductor que usa CASE-004, para que
 * el CSV no pueda contener nunca filas que el listado equivalente esconde —
 * incluido el alcance por tenant, que se deriva del contexto de autenticacion
 * y jamas del query string.
 *
 * La exportacion se audita: descargar el padron de casos de un tenant es
 * exactamente el movimiento que un investigador querra reconstruir despues.
 */
export function createExportCasesUseCase(deps: ExportCasesDeps) {
  return async function exportCases(input: ExportCasesInput): Promise<ExportCasesResult> {
    const baseFilter = toCaseListFilter({ ...input, limit: PAGE_SIZE });

    const rows: string[] = [COLUMNS.join(',')];
    let cursor: string | undefined;
    let rowCount = 0;
    let truncated = false;

    for (;;) {
      const page = await deps.cases.list({ ...baseFilter, limit: PAGE_SIZE, cursor });

      for (const kase of page.items) {
        if (rowCount >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
        rows.push(toRow(kase).map(csvCell).join(','));
        rowCount += 1;
      }

      if (truncated || !page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const now = deps.clock.now();
    const filename = `casos-${now.slice(0, 10)}.csv`;

    await deps.auditRecorder.record({
      organizationId: input.auth.organizationId ?? 'PLATFORM',
      actorType: input.auth.actorType,
      actorId: input.auth.userId ?? 'PLATFORM_ADMIN',
      action: 'EXPORT_CASES',
      resource: 'case',
      resourceId: 'bulk',
      detail: { rowCount, truncated, filter: { ...baseFilter, limit: undefined, cursor: undefined } },
      ipAddress: input.auth.ipAddress,
    });

    return {
      // CRLF y BOM: Excel en Windows abre el fichero como UTF-8 solo si lleva
      // BOM, y sin el los nombres con tilde o enye llegan corruptos.
      csv: `﻿${rows.join('\r\n')}\r\n`,
      rowCount,
      truncated,
      filename,
    };
  };
}
