import { invariantViolation } from '../../errors/RegulatoryError.js';

/**
 * Dos estados, no más.
 *
 * `DRAFT` se puede recompilar cuantas veces haga falta —los datos del periodo
 * siguen moviéndose mientras el periodo está reciente—. `ISSUED` es el momento
 * en que el documento sale del edificio: a partir de ahí es intocable, porque
 * existe una copia fuera bajo un número que alguien ya citó.
 */
export type RegulatoryReportStatus = 'DRAFT' | 'ISSUED';

export const REGULATORY_REPORT_STATUSES = ['DRAFT', 'ISSUED'] as const;

const VALID: ReadonlySet<string> = new Set<RegulatoryReportStatus>(REGULATORY_REPORT_STATUSES);

export function createRegulatoryReportStatus(value: string): RegulatoryReportStatus {
  if (!VALID.has(value)) {
    throw invariantViolation(`unknown regulatory report status "${value}"`, {
      value,
      allowed: [...REGULATORY_REPORT_STATUSES],
    });
  }
  return value as RegulatoryReportStatus;
}
