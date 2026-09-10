import { oid } from '../../support/oid.js';
import request from 'supertest';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { createApp } from '../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { notificationsErrorStatus } from '../../../src/modules/notifications/infrastructure/adapters/inbound/http/errorStatus.js';
import { notificationRouter } from '../../../src/modules/notifications/infrastructure/adapters/inbound/http/notificationRouter.js';
import type { createListNotificationsUseCase } from '../../../src/modules/notifications/application/ListNotifications.js';
import type { createMarkNotificationReadUseCase } from '../../../src/modules/notifications/application/MarkNotificationRead.js';
import type { createMarkAllNotificationsReadUseCase } from '../../../src/modules/notifications/application/MarkAllNotificationsRead.js';
import { Notification } from '../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createOrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createNotificationId } from '../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { notificationNotFound, forbiddenNotRecipient } from '../../../src/modules/notifications/domain/errors/NotificationsError.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildNotification() {
  return Notification.create({
    id: createNotificationId(oid('n1')),
    organizationId: createOrganizationId(oid('org-1')),
    recipientUserId: createUserId(oid('user-1')),
    alertType: 'CASE_ASSIGNED',
    channel: 'EMAIL',
    context: {},
    now: NOW,
  });
}

function buildApp(overrides: {
  listNotifications?: ReturnType<typeof createListNotificationsUseCase>;
  markNotificationRead?: ReturnType<typeof createMarkNotificationReadUseCase>;
  markAllNotificationsRead?: ReturnType<typeof createMarkAllNotificationsReadUseCase>;
  withAuth?: boolean;
}) {
  const withAuth = overrides.withAuth ?? true;
  const listNotifications =
    overrides.listNotifications ??
    ((async () => ({ items: [buildNotification()], total: 1 })) as unknown as ReturnType<
      typeof createListNotificationsUseCase
    >);
  const markNotificationRead =
    overrides.markNotificationRead ??
    ((async () => buildNotification().markRead(NOW)) as unknown as ReturnType<
      typeof createMarkNotificationReadUseCase
    >);
  const markAllNotificationsRead =
    overrides.markAllNotificationsRead ??
    ((async () => ({ updatedCount: 3 })) as unknown as ReturnType<typeof createMarkAllNotificationsReadUseCase>);

  const router = notificationRouter({ listNotifications, markNotificationRead, markAllNotificationsRead });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    if (withAuth) {
      attachAuthContext(req, createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') }));
    }
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

describe('notificationRouter', () => {
  it('GET /notifications returns 200 with items+total', async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      listNotifications: (async (input: unknown) => {
        calls.push(input);
        return { items: [buildNotification()], total: 1 };
      }) as unknown as ReturnType<typeof createListNotificationsUseCase>,
    });

    const response = await request(app).get('/api/v1/notifications?limit=10&offset=0');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].status).toBe('UNREAD');
    expect(calls).toEqual([expect.objectContaining({ limit: 10, offset: 0 })]);
  });

  it('GET /notifications without auth returns a 401/500-level failure with no attached AuthContext', async () => {
    const app = buildApp({ withAuth: false });

    const response = await request(app).get('/api/v1/notifications');

    expect(response.status).toBe(401);
  });

  it('PATCH /:id/read returns 200 on success', async () => {
    const app = buildApp({});

    const response = await request(app).patch(`/api/v1/notifications/${oid('n1')}/read`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('READ');
  });

  it('PATCH /:id/read returns 404 for an unknown id', async () => {
    const app = buildApp({
      markNotificationRead: (async () => {
        throw notificationNotFound(oid('missing'));
      }) as unknown as ReturnType<typeof createMarkNotificationReadUseCase>,
    });

    const response = await request(app).patch(`/api/v1/notifications/${oid('missing')}/read`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('PATCH /:id/read returns 403 when the caller is not the recipient', async () => {
    const app = buildApp({
      markNotificationRead: (async () => {
        throw forbiddenNotRecipient(oid('n1'));
      }) as unknown as ReturnType<typeof createMarkNotificationReadUseCase>,
    });

    const response = await request(app).patch(`/api/v1/notifications/${oid('n1')}/read`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('NOTIFICATION_FORBIDDEN_NOT_RECIPIENT');
  });

  it('PATCH /:id/read returns 200 (idempotent) when the notification is already READ', async () => {
    const app = buildApp({
      markNotificationRead: (async () => buildNotification().markRead(NOW)) as unknown as ReturnType<
        typeof createMarkNotificationReadUseCase
      >,
    });

    const response = await request(app).patch(`/api/v1/notifications/${oid('n1')}/read`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('READ');
  });

  it('PATCH /:id/read without auth returns a 401/500-level failure', async () => {
    const app = buildApp({ withAuth: false });

    const response = await request(app).patch(`/api/v1/notifications/${oid('n1')}/read`);

    expect(response.status).toBe(401);
  });

  it('POST /:id/read (old verb) no longer exists as a mark-read action', async () => {
    const app = buildApp({});

    const response = await request(app).post(`/api/v1/notifications/${oid('n1')}/read`);

    expect([404, 405]).toContain(response.status);
  });

  it('PATCH /notifications/read-all returns 200 with { updatedCount }', async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      markAllNotificationsRead: (async (input: unknown) => {
        calls.push(input);
        return { updatedCount: 5 };
      }) as unknown as ReturnType<typeof createMarkAllNotificationsReadUseCase>,
    });

    const response = await request(app).patch('/api/v1/notifications/read-all');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updatedCount: 5 });
    expect(calls).toHaveLength(1);
  });

  it('PATCH /notifications/read-all without auth returns a 401/500-level failure', async () => {
    const app = buildApp({ withAuth: false });

    const response = await request(app).patch('/api/v1/notifications/read-all');

    expect(response.status).toBe(401);
  });

  it('PATCH /notifications/read-all is idempotent — a second call with zero unread returns { updatedCount: 0 }', async () => {
    let call = 0;
    const app = buildApp({
      markAllNotificationsRead: (async () => {
        call += 1;
        return { updatedCount: call === 1 ? 3 : 0 };
      }) as unknown as ReturnType<typeof createMarkAllNotificationsReadUseCase>,
    });

    const first = await request(app).patch('/api/v1/notifications/read-all');
    const second = await request(app).patch('/api/v1/notifications/read-all');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.updatedCount).toBe(0);
  });

  it('PATCH /notifications/read-all is routed to the bulk handler, not captured as :id="read-all"', async () => {
    const markNotificationRead = jest.fn();
    const app = buildApp({
      markNotificationRead: markNotificationRead as unknown as ReturnType<typeof createMarkNotificationReadUseCase>,
    });

    const response = await request(app).patch('/api/v1/notifications/read-all');

    expect(response.status).not.toBe(404);
    expect(response.body.error?.code).not.toBe('NOTIFICATION_NOT_FOUND');
    expect(markNotificationRead).not.toHaveBeenCalled();
  });
});
