import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createCreateWebhookSubscriptionUseCase } from '../../../../application/CreateWebhookSubscription.js';
import type { createListWebhookSubscriptionUseCase } from '../../../../application/ListWebhookSubscription.js';
import type { createGetWebhookSubscriptionUseCase } from '../../../../application/GetWebhookSubscription.js';
import type { createUpdateWebhookSubscriptionUseCase } from '../../../../application/UpdateWebhookSubscription.js';
import type { createDeleteWebhookSubscriptionUseCase } from '../../../../application/DeleteWebhookSubscription.js';
import {
  createWebhookSubscriptionSchema,
  listWebhookSubscriptionsQuerySchema,
  updateWebhookSubscriptionSchema,
} from './dto/webhookSubscriptionSchemas.js';
import { toWebhookSubscriptionResponse } from './mappers/WebhookSubscriptionHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface WebhookSubscriptionRouterDeps {
  readonly createWebhookSubscription: ReturnType<typeof createCreateWebhookSubscriptionUseCase>;
  readonly listWebhookSubscription: ReturnType<typeof createListWebhookSubscriptionUseCase>;
  readonly getWebhookSubscription: ReturnType<typeof createGetWebhookSubscriptionUseCase>;
  readonly updateWebhookSubscription: ReturnType<typeof createUpdateWebhookSubscriptionUseCase>;
  readonly deleteWebhookSubscription: ReturnType<typeof createDeleteWebhookSubscriptionUseCase>;
}

/**
 * `/webhook-subscriptions` catalog CRUD. Express 5 forwards rejected handler
 * promises to `errorHandler`. Writes are SUPERVISOR; reads are OVERSIGHT.
 */
export function webhookSubscriptionRouter(deps: WebhookSubscriptionRouterDeps): Router {
  const router = Router();

  router.post('/webhook-subscriptions', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(createWebhookSubscriptionSchema, req.body);
    const subscription = await deps.createWebhookSubscription({
      auth,
      url: body.url,
      eventTypes: body.eventTypes,
      active: body.active,
    });
    res.status(201).json(toWebhookSubscriptionResponse(subscription));
  });

  router.get('/webhook-subscriptions', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listWebhookSubscriptionsQuerySchema, req.query);
    const items = await deps.listWebhookSubscription({ auth, active: query.active });
    res.status(200).json({ items: items.map(toWebhookSubscriptionResponse) });
  });

  router.get('/webhook-subscriptions/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const subscription = await deps.getWebhookSubscription({
      auth,
      subscriptionId: req.params.id!,
    });
    res.status(200).json(toWebhookSubscriptionResponse(subscription));
  });

  router.patch('/webhook-subscriptions/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(updateWebhookSubscriptionSchema, req.body);
    const subscription = await deps.updateWebhookSubscription({
      auth,
      subscriptionId: req.params.id!,
      url: body.url,
      eventTypes: body.eventTypes,
      active: body.active,
    });
    res.status(200).json(toWebhookSubscriptionResponse(subscription));
  });

  router.delete('/webhook-subscriptions/:id', async (req, res) => {
    const auth = requireAuthContext(req);
    const subscription = await deps.deleteWebhookSubscription({
      auth,
      subscriptionId: req.params.id!,
    });
    res.status(200).json(toWebhookSubscriptionResponse(subscription));
  });

  return router;
}
