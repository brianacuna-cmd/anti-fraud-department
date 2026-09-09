import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createListNotificationsUseCase } from '../../../../application/ListNotifications.js';
import type { createMarkNotificationReadUseCase } from '../../../../application/MarkNotificationRead.js';
import type { createMarkAllNotificationsReadUseCase } from '../../../../application/MarkAllNotificationsRead.js';
import { listNotificationsQuerySchema } from './dto/notificationSchemas.js';
import { toNotificationPageResponse, toNotificationResponse } from './mappers/NotificationHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface NotificationRouterDeps {
  readonly listNotifications: ReturnType<typeof createListNotificationsUseCase>;
  readonly markNotificationRead: ReturnType<typeof createMarkNotificationReadUseCase>;
  readonly markAllNotificationsRead: ReturnType<typeof createMarkAllNotificationsReadUseCase>;
}

/**
 * `/notifications` routes — self-only inbox (R3/R4, design D8). Express 5
 * forwards a rejected handler promise to `errorHandler` automatically.
 *
 * `/notifications/read-all` MUST be registered before `/notifications/:id/read`
 * (R5) so Express never resolves the literal path segment "read-all" to the
 * `:id` handler.
 */
export function notificationRouter(deps: NotificationRouterDeps): Router {
  const router = Router();

  router.get('/notifications', async (req, res) => {
    const auth = requireAuthContext(req);
    const query = parseRequest(listNotificationsQuerySchema, req.query);
    const page = await deps.listNotifications({
      auth,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    res.status(200).json(toNotificationPageResponse(page));
  });

  router.patch('/notifications/read-all', async (req, res) => {
    const auth = requireAuthContext(req);
    const { updatedCount } = await deps.markAllNotificationsRead({ auth });
    res.status(200).json({ updatedCount });
  });

  router.patch('/notifications/:id/read', async (req, res) => {
    const auth = requireAuthContext(req);
    const notification = await deps.markNotificationRead({ auth, id: req.params.id! });
    res.status(200).json(toNotificationResponse(notification));
  });

  return router;
}
