import { z } from 'zod';

const amlAlertStatusEnum = z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE']);

/** Coerces Express query `string | string[]` into a string array. */
function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

/**
 * GET /aml-alerts query (compliance inbox). `organization_id` comes from
 * the tenant auth context — not from the query string.
 */
export const listAmlAlertsQuerySchema = z.object({
  estado: z.preprocess(asStringArray, z.array(amlAlertStatusEnum).optional()),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListAmlAlertsQuery = z.infer<typeof listAmlAlertsQuerySchema>;

/** PATCH /aml-alerts/:alertId/resolve body. */
export const resolveAmlAlertSchema = z.object({
  dictamen: z.enum(['CONFIRMED_MATCH', 'FALSE_POSITIVE']),
  justificacion: z.string().trim().min(1),
});

export type ResolveAmlAlertBody = z.infer<typeof resolveAmlAlertSchema>;
