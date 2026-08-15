import { z } from 'zod';

/**
 * PUT /inbound-webhook-secrets body — upsert-only (design D6).
 */
export const upsertInboundWebhookSecretSchema = z
  .object({
    provider: z.enum(['stripe', 'bridge', 'coinflow']),
    secret: z.string().min(1),
  })
  .strict();

export type UpsertInboundWebhookSecretBody = z.infer<typeof upsertInboundWebhookSecretSchema>;
