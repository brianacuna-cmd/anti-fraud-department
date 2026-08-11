import request from 'supertest';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { notificationsErrorStatus } from '../../../src/modules/notifications/infrastructure/adapters/inbound/http/errorStatus.js';
import { notificationPreferenceRouter } from '../../../src/modules/notifications/infrastructure/adapters/inbound/http/notificationPreferenceRouter.js';
import type { createGetNotificationPreferencesUseCase } from '../../../src/modules/notifications/application/GetNotificationPreferences.js';
import type { createSetNotificationPreferenceUseCase } from '../../../src/modules/notifications/application/SetNotificationPreference.js';
import { NotificationPreference } from '../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildApp(overrides: {
  getNotificationPreferences?: ReturnType<typeof createGetNotificationPreferencesUseCase>;
  setNotificationPreference?: ReturnType<typeof createSetNotificationPreferenceUseCase>;
}) {
  const getNotificationPreferences =
    overrides.getNotificationPreferences ??
    ((async () => []) as unknown as ReturnType<typeof createGetNotificationPreferencesUseCase>);
  const setNotificationPreference =
    overrides.setNotificationPreference ??
    ((async () =>
      NotificationPreference.create({
        organizationId: createOrganizationId('org-1'),
        userId: createUserId('user-1'),
        alertType: 'CASO_ASIGNADO',
        channel: 'EMAIL',
        enabled: true,
        now: NOW,
      })) as unknown as ReturnType<typeof createSetNotificationPreferenceUseCase>);

  const router = notificationPreferenceRouter({ getNotificationPreferences, setNotificationPreference });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, createAuthContext({ userId: 'user-1', organizationId: 'org-1' }));
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  return createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(notificationsErrorStatus),
  });
}

describe('notificationPreferenceRouter', () => {
  it('GET /notifications/preferences returns 200 with the effective matrix', async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      getNotificationPreferences: (async (input: unknown) => {
        calls.push(input);
        return [{ alertType: 'CASO_ASIGNADO', channel: 'EMAIL', enabled: true }];
      }) as unknown as ReturnType<typeof createGetNotificationPreferencesUseCase>,
    });

    const response = await request(app).get('/api/v1/notifications/preferences');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [{ alertType: 'caso_asignado', channel: 'EMAIL', enabled: true }] });
    expect(calls).toHaveLength(1);
  });

  it('PUT /notifications/preferences/:alertType/:channel translates the wire alertType to domain casing and returns 200', async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      setNotificationPreference: (async (input: unknown) => {
        calls.push(input);
        return NotificationPreference.create({
          organizationId: createOrganizationId('org-1'),
          userId: createUserId('user-1'),
          alertType: 'CASO_ASIGNADO',
          channel: 'EMAIL',
          enabled: false,
          now: NOW,
        });
      }) as unknown as ReturnType<typeof createSetNotificationPreferenceUseCase>,
    });

    const response = await request(app)
      .put('/api/v1/notifications/preferences/caso_asignado/EMAIL')
      .send({ enabled: false });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ alertType: 'caso_asignado', channel: 'EMAIL', enabled: false, updatedAt: NOW });
    expect(calls).toEqual([
      expect.objectContaining({ alertType: 'CASO_ASIGNADO', channel: 'EMAIL', enabled: false }),
    ]);
  });

  it('rejects an unknown alertType wire value with 422', async () => {
    const app = buildApp({});

    const response = await request(app)
      .put('/api/v1/notifications/preferences/not_a_real_alert/EMAIL')
      .send({ enabled: true });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNKNOWN_ALERT_TYPE');
  });

  it('rejects an unknown channel with 422', async () => {
    const app = buildApp({});

    const response = await request(app)
      .put('/api/v1/notifications/preferences/caso_asignado/SMS')
      .send({ enabled: true });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNKNOWN_CHANNEL');
  });

  it('rejects a malformed body with 400', async () => {
    const app = buildApp({});

    const response = await request(app)
      .put('/api/v1/notifications/preferences/caso_asignado/EMAIL')
      .send({ enabled: 'not-a-boolean' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('requires auth — 401/500-level failure with no attached AuthContext', async () => {
    const router = notificationPreferenceRouter({
      getNotificationPreferences: (async () => []) as unknown as ReturnType<
        typeof createGetNotificationPreferencesUseCase
      >,
      setNotificationPreference: (async () =>
        NotificationPreference.create({
          organizationId: createOrganizationId('org-1'),
          userId: createUserId('user-1'),
          alertType: 'CASO_ASIGNADO',
          channel: 'EMAIL',
          enabled: true,
          now: NOW,
        })) as unknown as ReturnType<typeof createSetNotificationPreferenceUseCase>,
    });
    const app = createApp({
      routers: [{ path: '/api/v1', router }],
      errorHandler: createErrorHandler(notificationsErrorStatus),
    });

    const response = await request(app).get('/api/v1/notifications/preferences');

    expect(response.status).toBe(500);
  });
});
