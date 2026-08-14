import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createUpsertInboundWebhookSecretUseCase } from '../../../../application/UpsertInboundWebhookSecret.js';
import { upsertInboundWebhookSecretSchema } from './dto/inboundWebhookSecretSchemas.js';
import { parseRequest } from './parseRequest.js';

export interface InboundWebhookSecretRouterDeps {
  readonly upsertInboundWebhookSecret: ReturnType<typeof createUpsertInboundWebhookSecretUseCase>;
}

/**
 * JWT upsert-only inbound webhook secrets on `/api/v1` (design D6).
 * No GET — plaintext and ciphertext must never be returned.
 */
export function inboundWebhookSecretRouter(deps: InboundWebhookSecretRouterDeps): Router {
  const router = Router();

  router.put('/inbound-webhook-secrets', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(upsertInboundWebhookSecretSchema, req.body);
    const result = await deps.upsertInboundWebhookSecret({
      auth,
      provider: body.provider,
      secret: body.secret,
    });
    res.status(200).json({ provider: result.provider, updatedAt: result.updatedAt });
  });

  return router;
}
