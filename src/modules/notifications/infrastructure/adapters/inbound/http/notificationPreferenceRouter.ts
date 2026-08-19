import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGetNotificationPreferencesUseCase } from '../../../../application/GetNotificationPreferences.js';
import type { createSetNotificationPreferenceUseCase } from '../../../../application/SetNotificationPreference.js';
import type {
  createListNotificationsUseCase,
  createMarkNotificationReadUseCase,
} from '../../../../application/ListNotifications.js';
import { unknownAlertType, unknownChannel } from '../../../../domain/errors/NotificationsError.js';
import { WIRE_TO_ALERT_TYPE, setPreferenceBodySchema, type WireAlertType } from './dto/notificationPreferenceSchemas.js';
import { toPreferenceResponse, toPreferenceMatrixResponse } from './mappers/NotificationPreferenceHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface NotificationPreferenceRouterDeps {
  readonly getNotificationPreferences: ReturnType<typeof createGetNotificationPreferencesUseCase>;
  readonly setNotificationPreference: ReturnType<typeof createSetNotificationPreferenceUseCase>;
  readonly listNotifications?: ReturnType<typeof createListNotificationsUseCase>;
  readonly markNotificationRead?: ReturnType<typeof createMarkNotificationReadUseCase>;
}

/** Forma de un aviso en la respuesta HTTP. */
function toNotificationResponse(n: {
  id: string;
  alertType: string;
  channel: string;
  title: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
}) {
  return {
    id: n.id,
    alertType: n.alertType,
    channel: n.channel,
    title: n.title,
    body: n.body,
    resourceType: n.resourceType,
    resourceId: n.resourceId,
    readAt: n.readAt,
    read: n.readAt !== null,
    createdAt: n.createdAt,
  };
}

/**
 * `/notifications/preferences` routes — self-only, "my preferences" (design
 * D6/D8). Express 5 forwards a rejected handler promise to `errorHandler`
 * automatically.
 */
export function notificationPreferenceRouter(deps: NotificationPreferenceRouterDeps): Router {
  const router = Router();

  // La bandeja del usuario. `/notifications/preferences` se declara despues,
  // pero ambas son rutas literales sin parametros, asi que no compiten.
  router.get('/notifications', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.listNotifications) return res.status(501).json({ message: 'Notifications inbox not available' });
    const page = await deps.listNotifications({
      auth,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      unreadOnly: req.query.unreadOnly === 'true',
    });
    res.status(200).json({
      items: page.items.map(toNotificationResponse),
      unreadCount: page.unreadCount,
    });
  });

  router.post('/notifications/:id/read', async (req, res) => {
    const auth = requireAuthContext(req);
    if (!deps.markNotificationRead) return res.status(501).json({ message: 'Notifications inbox not available' });
    const notification = await deps.markNotificationRead({ auth, notificationId: req.params.id! });
    res.status(200).json(toNotificationResponse(notification));
  });

  router.get('/notifications/preferences', async (req, res) => {
    const auth = requireAuthContext(req);
    const matrix = await deps.getNotificationPreferences({ auth });
    res.status(200).json(toPreferenceMatrixResponse(matrix));
  });

  router.put('/notifications/preferences/:alertType/:channel', async (req, res) => {
    const auth = requireAuthContext(req);

    const wireAlertType = req.params.alertType as WireAlertType;
    const alertType = WIRE_TO_ALERT_TYPE[wireAlertType];
    if (alertType === undefined) {
      throw unknownAlertType(req.params.alertType!);
    }

    const channel = req.params.channel!;
    if (channel !== 'EMAIL') {
      throw unknownChannel(channel);
    }

    const { enabled } = parseRequest(setPreferenceBodySchema, req.body);
    const pref = await deps.setNotificationPreference({ auth, alertType, channel, enabled });
    res.status(200).json(toPreferenceResponse(pref));
  });

  return router;
}
