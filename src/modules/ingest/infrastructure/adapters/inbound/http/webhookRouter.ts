import { Router } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { createReceiveProviderWebhookUseCase } from '../../../../application/ReceiveProviderWebhook.js';
import { invariantViolation } from '../../../../domain/errors/IngestError.js';

export interface WebhookRouterDeps {
  readonly receiveProviderWebhook: ReturnType<typeof createReceiveProviderWebhookUseCase>;
}

/**
 * Provider webhook HTTP adapter (design A2/D4). No JWT. Raw `req.body` Buffer
 * from createApp's express.raw mount. ACK 200 then the use case schedules
 * PostAckComposer via setImmediate.
 */
export function webhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();

  router.post('/:provider/:organizationId', async (req, res) => {
    const result = await deps.receiveProviderWebhook({
      organizationId: singleParam(req.params.organizationId),
      provider: singleParam(req.params.provider),
      rawBody: asRawBuffer(req.body),
      headers: flattenHeaders(req.headers),
    });
    res.status(200).json({ status: result.status });
  });

  return router;
}

function asRawBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  throw invariantViolation('webhook body must be a raw Buffer');
}

function singleParam(value: string | string[] | undefined): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw invariantViolation('webhook path params provider and organizationId are required');
}

function flattenHeaders(headers: IncomingHttpHeaders): Readonly<Record<string, string | undefined>> {
  const flattened: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    flattened[name] = Array.isArray(value) ? value[0] : value;
  }
  return flattened;
}
