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
   * Shared secret for signing what we send to `outboundWebhookUrl`.
   * Accepted on write and NEVER returned: the response only says whether one
   * is set. A secret the API returns stops being a secret as soon as anyone
   * with read permission looks at the config.
   */
  outboundWebhookSecret: z.string().min(32).nullable().optional(),
  })
  .strict();

export type UpsertOrganizationFraudConfigBody = z.infer<typeof upsertOrganizationFraudConfigSchema>;
