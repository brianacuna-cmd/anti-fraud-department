import { oid } from '../../../support/oid.js';
import { createMarkAllNotificationsReadUseCase } from '../../../../src/modules/notifications/application/MarkAllNotificationsRead.js';
import { InMemoryNotificationRepository } from '../../../helpers/notifications/InMemoryNotificationRepository.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Notification } from '../../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { generateNotificationId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { Clock } from '../../../../src/shared/time/Clock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const fixedClock: Clock = { now: () => LATER };

const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const USER_A = createAuthContext({ userId: oid('user-a'), organizationId: ORG_1 });

function buildNotification(options: { org: string; recipient: string; status?: 'UNREAD' | 'READ' }) {
  const notification = Notification.create({
    id: generateNotificationId(),
    organizationId: createOrganizationId(options.org),
    recipientUserId: createUserId(options.recipient),
    alertType: 'CASE_ASSIGNED',
    channel: 'EMAIL',
    context: {},
    now: NOW,
  });
  return options.status === 'READ' ? notification.markRead(NOW) : notification;
}

describe('createMarkAllNotificationsReadUseCase', () => {
  it('flips only the caller UNREAD notifications and returns the count', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'UNREAD' }));
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'UNREAD' }));
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'UNREAD' }));
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'READ' }));
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'READ' }));
    const markAllRead = createMarkAllNotificationsReadUseCase({ repository, clock: fixedClock });

    const result = await markAllRead({ auth: USER_A });

    expect(result.updatedCount).toBe(3);
    const page = await repository.findByRecipient(createOrganizationId(ORG_1), createUserId(oid('user-a')), {
      limit: 10,
      offset: 0,
    });
    expect(page.items.every((n) => n.status === 'READ')).toBe(true);
  });

  it('returns 0 when there are no UNREAD notifications', async () => {
    const repository = new InMemoryNotificationRepository();
    const markAllRead = createMarkAllNotificationsReadUseCase({ repository, clock: fixedClock });

    const result = await markAllRead({ auth: USER_A });

    expect(result.updatedCount).toBe(0);
  });

  it('is idempotent — a second call returns 0', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'UNREAD' }));
    const markAllRead = createMarkAllNotificationsReadUseCase({ repository, clock: fixedClock });

    await markAllRead({ auth: USER_A });
    const second = await markAllRead({ auth: USER_A });

    expect(second.updatedCount).toBe(0);
  });

  it('does not affect another user in the same organization', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'UNREAD' }));
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-b'), status: 'UNREAD' }));
    const markAllRead = createMarkAllNotificationsReadUseCase({ repository, clock: fixedClock });

    await markAllRead({ auth: USER_A });

    const bPage = await repository.findByRecipient(createOrganizationId(ORG_1), createUserId(oid('user-b')), {
      limit: 10,
      offset: 0,
    });
    expect(bPage.items.every((n) => n.status === 'UNREAD')).toBe(true);
  });

  it('does not affect the same recipientUserId under a different organization', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification({ org: ORG_1, recipient: oid('user-a'), status: 'UNREAD' }));
    await repository.save(buildNotification({ org: ORG_2, recipient: oid('user-a'), status: 'UNREAD' }));
    const markAllRead = createMarkAllNotificationsReadUseCase({ repository, clock: fixedClock });

    await markAllRead({ auth: USER_A });

    const org2Page = await repository.findByRecipient(createOrganizationId(ORG_2), createUserId(oid('user-a')), {
      limit: 10,
      offset: 0,
    });
    expect(org2Page.items.every((n) => n.status === 'UNREAD')).toBe(true);
  });
});
