import { oid } from '../../../support/oid.js';
import { createListNotificationsUseCase } from '../../../../src/modules/notifications/application/ListNotifications.js';
import { InMemoryNotificationRepository } from '../../../helpers/notifications/InMemoryNotificationRepository.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Notification } from '../../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createNotificationId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

const ORG_1_USER_A = createAuthContext({ userId: oid('user-a'), organizationId: oid('org-1') });

function makeNotification(overrides: {
  id: string;
  recipient: string;
  now: string;
  status?: 'UNREAD' | 'READ';
}) {
  const notification = Notification.create({
    id: createNotificationId(oid(overrides.id)),
    organizationId: createOrganizationId(oid('org-1')),
    recipientUserId: createUserId(oid(overrides.recipient)),
    alertType: 'CASE_ASSIGNED',
    channel: 'EMAIL',
    context: {},
    now: fromDate(new Date(overrides.now)),
  });
  return overrides.status === 'READ' ? notification.markRead(fromDate(new Date(overrides.now))) : notification;
}

describe('createListNotificationsUseCase', () => {
  it("returns only the caller's own notifications, never another user's", async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(
      makeNotification({ id: 'n1', recipient: 'user-a', now: '2026-01-01T00:00:00.000Z' }),
    );
    await repository.save(
      makeNotification({ id: 'n2', recipient: 'user-b', now: '2026-01-01T00:00:01.000Z' }),
    );
    const listNotifications = createListNotificationsUseCase({ repository });

    const page = await listNotifications({ auth: ORG_1_USER_A, limit: 20, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.recipientUserId).toBe(oid('user-a'));
    expect(page.total).toBe(1);
  });

  it('honors the status=UNREAD filter', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(
      makeNotification({ id: 'n1', recipient: 'user-a', now: '2026-01-01T00:00:00.000Z', status: 'READ' }),
    );
    await repository.save(
      makeNotification({ id: 'n2', recipient: 'user-a', now: '2026-01-01T00:00:01.000Z' }),
    );
    const listNotifications = createListNotificationsUseCase({ repository });

    const page = await listNotifications({ auth: ORG_1_USER_A, status: 'UNREAD', limit: 20, offset: 0 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe('UNREAD');
  });

  it('paginates with limit/offset, newest-first', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(
      makeNotification({ id: 'n1', recipient: 'user-a', now: '2026-01-01T00:00:00.000Z' }),
    );
    await repository.save(
      makeNotification({ id: 'n2', recipient: 'user-a', now: '2026-01-02T00:00:00.000Z' }),
    );
    await repository.save(
      makeNotification({ id: 'n3', recipient: 'user-a', now: '2026-01-03T00:00:00.000Z' }),
    );
    const listNotifications = createListNotificationsUseCase({ repository });

    const page = await listNotifications({ auth: ORG_1_USER_A, limit: 2, offset: 0 });

    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe(oid('n3'));
    expect(page.items[1]?.id).toBe(oid('n2'));
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT', async () => {
    const repository = new InMemoryNotificationRepository();
    const listNotifications = createListNotificationsUseCase({ repository });
    const platformAdmin = createAuthContext({ userId: oid('admin-1'), organizationId: null, isPlatformAdmin: true });

    expect.assertions(2);
    try {
      await listNotifications({ auth: platformAdmin, limit: 20, offset: 0 });
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as InstanceType<typeof NotificationsError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
