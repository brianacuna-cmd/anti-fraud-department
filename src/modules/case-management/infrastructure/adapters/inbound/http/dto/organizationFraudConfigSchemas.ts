import { z } from 'zod';

/**
 * PUT /organization-fraud-config body — full upsert payload for the
 * per-tenant OrganizationFraudConfig singleton (SLA minutes + risk
 * thresholds + optional feature flags).
 */
export const upsertOrganizationFraudConfigSchema = z
  .object({
    slaLowMinutes: z.number().int().nonnegative(),
    slaMediumMinutes: z.number().int().nonnegative(),
    slaHighMinutes: z.number().int().nonnegative(),
    slaCriticalMinutes: z.number().int().nonnegative(),
    riskThresholdLow: z.number().int().nonnegative(),
    riskThresholdMedium: z.number().int().nonnegative(),
    riskThresholdHigh: z.number().int().nonnegative(),
    riskThresholdCritical: z.number().int().nonnegative(),
    featureFlags: z.record(z.string(), z.boolean()).optional(),
    outboundWebhookUrl: z.string().url().nullable().optional(),
  /**
   * Secreto compartido para firmar lo que enviamos a `outboundWebhookUrl`.
   * Se acepta al escribir y NUNCA se devuelve: la respuesta solo dice si hay
   * uno puesto. Un secreto que la API devuelve deja de ser un secreto en
   * cuanto alguien con permiso de lectura mira la configuracion.
   */
  outboundWebhookSecret: z.string().min(32).nullable().optional(),
  })
  .strict();

export type UpsertOrganizationFraudConfigBody = z.infer<typeof upsertOrganizationFraudConfigSchema>;
