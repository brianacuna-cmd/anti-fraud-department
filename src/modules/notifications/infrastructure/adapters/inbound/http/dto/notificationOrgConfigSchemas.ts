import { z } from 'zod';

/**
 * PUT /notification-org-config body — upserts the per-tenant webhook
 * destination (spec Req 1). `webhookUrl` is validated http(s) here at the
 * transport boundary AND at the aggregate (`assertWebhookUrl`) — both
 * translate to `INVARIANT_VIOLATION` (400).
 */
export const upsertNotificationOrgConfigSchema = z
  .object({
    webhookUrl: z.string().url().nullable().optional(),
    /**
     * Shared secret, stored but unused this change (spec Req 4). Accepted on
     * write and NEVER returned: the response only says whether one is set.
     */
    secret: z.string().nullable().optional(),
  })
  .strict();

export type UpsertNotificationOrgConfigBody = z.infer<typeof upsertNotificationOrgConfigSchema>;
