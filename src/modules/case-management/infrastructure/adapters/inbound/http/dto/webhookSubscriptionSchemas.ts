import { z } from 'zod';

const TICKET_EVENT_TYPES = ['case.created', 'case.resolved', 'aml.alert_generated'] as const;

const httpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'url must be an http(s) URL' },
  );

const eventTypesSchema = z.array(z.enum(TICKET_EVENT_TYPES)).min(1);

/** POST /webhook-subscriptions body. `active` defaults in the aggregate. */
export const createWebhookSubscriptionSchema = z
  .object({
    url: httpUrlSchema,
    eventTypes: eventTypesSchema,
    active: z.boolean().optional(),
  })
  .strict();

/**
 * PATCH /webhook-subscriptions/:id body. `active` is patchable (unlike
 * watchlists); deactivate is UPDATE, not DELETE.
 */
export const updateWebhookSubscriptionSchema = z
  .object({
    url: httpUrlSchema.optional(),
    eventTypes: eventTypesSchema.optional(),
    active: z.boolean().optional(),
  })
  .strict();

function asOptionalBoolean(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}

/** GET /webhook-subscriptions query. Optional `active` filter. */
export const listWebhookSubscriptionsQuerySchema = z.object({
  active: z.preprocess(asOptionalBoolean, z.boolean().optional()),
});

export type CreateWebhookSubscriptionBody = z.infer<typeof createWebhookSubscriptionSchema>;
export type UpdateWebhookSubscriptionBody = z.infer<typeof updateWebhookSubscriptionSchema>;
export type ListWebhookSubscriptionsQuery = z.infer<typeof listWebhookSubscriptionsQuerySchema>;
