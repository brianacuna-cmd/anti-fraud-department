import { z } from 'zod';
import { REGULATORY_REPORT_STATUSES } from '../../../../../domain/model/value-objects/RegulatoryReportStatus.js';

/**
 * POST /regulatory-reports.
 *
 * El esquema solo comprueba que sean fechas; que el periodo tenga sentido
 * —que empiece antes de acabar y que no llegue al futuro— lo decide el
 * agregado. Duplicar esa regla aquí crearía dos definiciones de "periodo
 * válido" que acabarían divergiendo.
 */
export const compileRegulatoryReportSchema = z
  .object({
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    /** Cuando viene, se recompila ese borrador en vez de crear otro. */
    reportId: z.string().min(1).optional(),
  })
  .strict();

export const listRegulatoryReportsQuerySchema = z
  .object({
    status: z
      .union([z.enum(REGULATORY_REPORT_STATUSES), z.array(z.enum(REGULATORY_REPORT_STATUSES))])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export const exportRegulatoryReportQuerySchema = z
  .object({ format: z.enum(['pdf', 'xlsx']).default('pdf') })
  .strict();
