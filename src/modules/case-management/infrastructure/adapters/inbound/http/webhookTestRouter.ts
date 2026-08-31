import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createTestOutgoingWebhookUseCase } from '../../../../application/TestOutgoingWebhook.js';
import { webhookTestBodySchema } from './dto/webhookTestSchemas.js';
import { parseRequest } from './parseRequest.js';

export interface WebhookTestRouterDeps {
  readonly testOutgoingWebhook: ReturnType<typeof createTestOutgoingWebhookUseCase>;
}

/**
 * SUPERVISOR probe `POST /webhooks/test`. Mounted on the authenticated
 * identity-access router at `/api/v1`, never on inbound `/webhooks`.
 */
export function webhookTestRouter(deps: WebhookTestRouterDeps): Router {
  const router = Router();

  router.post('/webhooks/test', async (req, res) => {
    const auth = requireAuthContext(req);
    parseRequest(webhookTestBodySchema, req.body ?? {});
    const result = await deps.testOutgoingWebhook({ auth });
    res.status(200).json(result);
  });

  return router;
}
