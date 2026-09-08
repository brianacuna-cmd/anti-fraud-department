import { z } from 'zod';

/** POST /webhooks/test body: empty object only. Extra keys (including `url`) are 400. */
export const webhookTestBodySchema = z.object({}).strict();
