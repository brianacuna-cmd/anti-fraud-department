import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGetNotificationOrgConfigUseCase } from '../../../../application/GetNotificationOrgConfig.js';
import type { createUpsertNotificationOrgConfigUseCase } from '../../../../application/UpsertNotificationOrgConfig.js';
import { upsertNotificationOrgConfigSchema } from './dto/notificationOrgConfigSchemas.js';
import { toNotificationOrgConfigResponse } from './mappers/NotificationOrgConfigHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface NotificationOrgConfigRouterDeps {
  readonly getNotificationOrgConfig: ReturnType<typeof createGetNotificationOrgConfigUseCase>;
  readonly upsertNotificationOrgConfig: ReturnType<typeof createUpsertNotificationOrgConfigUseCase>;
}

/**
 * `/notification-org-config` routes — Get/Upsert for the per-tenant webhook
 * destination singleton (spec Req 1). GET never 404s (ADR-6); PUT is gated
 * by `SUPERVISION_ROLES` (ADR-5). Express 5 forwards a rejected handler
 * promise to `errorHandler` automatically.
 */
export function notificationOrgConfigRouter(deps: NotificationOrgConfigRouterDeps): Router {
  const router = Router();

  router.get('/notification-org-config', async (req, res) => {
    const auth = requireAuthContext(req);
    const config = await deps.getNotificationOrgConfig({ auth });
    res.status(200).json(toNotificationOrgConfigResponse(config));
  });

  router.put('/notification-org-config', async (req, res) => {
    const auth = requireAuthContext(req);
    const body = parseRequest(upsertNotificationOrgConfigSchema, req.body);
    const config = await deps.upsertNotificationOrgConfig({ auth, ...body });
    res.status(200).json(toNotificationOrgConfigResponse(config));
  });

  return router;
}
