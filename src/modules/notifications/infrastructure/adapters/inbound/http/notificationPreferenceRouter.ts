import { Router } from 'express';
import { requireAuthContext } from '../../../../../../shared/http/requestAuthContext.js';
import type { createGetNotificationPreferencesUseCase } from '../../../../application/GetNotificationPreferences.js';
import type { createSetNotificationPreferenceUseCase } from '../../../../application/SetNotificationPreference.js';
import type { createSetNotificationPreferencesUseCase } from '../../../../application/SetNotificationPreferences.js';
import { unknownAlertType } from '../../../../domain/errors/NotificationsError.js';
import {
  WIRE_TO_ALERT_TYPE,
  setPreferenceBodySchema,
  bulkSetPreferencesBodySchema,
  type WireAlertType,
} from './dto/notificationPreferenceSchemas.js';
import { toPreferenceResponse, toPreferenceMatrixResponse } from './mappers/NotificationPreferenceHttpMapper.js';
import { parseRequest } from './parseRequest.js';

export interface NotificationPreferenceRouterDeps {
  readonly getNotificationPreferences: ReturnType<typeof createGetNotificationPreferencesUseCase>;
  readonly setNotificationPreference: ReturnType<typeof createSetNotificationPreferenceUseCase>;
  readonly setNotificationPreferences: ReturnType<typeof createSetNotificationPreferencesUseCase>;
}

/**
 * `/notifications/preferences` routes — self-only, "my preferences" (design
 * D6/D8). Express 5 forwards a rejected handler promise to `errorHandler`
 * automatically.
 */
export function notificationPreferenceRouter(deps: NotificationPreferenceRouterDeps): Router {
  const router = Router();

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

    const { enabled } = parseRequest(setPreferenceBodySchema, req.body);
    const pref = await deps.setNotificationPreference({ auth, alertType, channel, enabled });
    res.status(200).json(toPreferenceResponse(pref));
  });

  router.get('/users/me/notification-preferences', async (req, res) => {
    const auth = requireAuthContext(req);
    const matrix = await deps.getNotificationPreferences({ auth });
    res.status(200).json(toPreferenceMatrixResponse(matrix));
  });

  router.patch('/users/me/notification-preferences', async (req, res) => {
    const auth = requireAuthContext(req);

    const { entries } = parseRequest(bulkSetPreferencesBodySchema, req.body);
    const mappedEntries = entries.map((entry) => {
      const wireAlertType = entry.alertType as WireAlertType;
      const alertType = WIRE_TO_ALERT_TYPE[wireAlertType];
      if (alertType === undefined) {
        throw unknownAlertType(entry.alertType);
      }
      return { alertType, channel: entry.channel, enabled: entry.enabled };
    });

    await deps.setNotificationPreferences({ auth, entries: mappedEntries });
    const matrix = await deps.getNotificationPreferences({ auth });
    res.status(200).json(toPreferenceMatrixResponse(matrix));
  });

  return router;
}
