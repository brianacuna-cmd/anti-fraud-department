import { oid } from '../../../support/oid.js';
import { createMarkNotificationReadUseCase } from '../../../../src/modules/notifications/application/MarkNotificationRead.js';
import { InMemoryNotificationRepository } from '../../../helpers/notifications/InMemoryNotificationRepository.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Notification } from '../../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createNotificationId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';
import type { Clock } from '../../../../src/shared/time/Clock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const fixedClock: Clock = { now: () => LATER };

const USER_A = createAuthContext({ userId: oid('user-a'), organizationId: oid('org-1') });
const USER_B = createAuthContext({ userId: oid('user-b'), organizationId: oid('org-1') });

function buildNotification() {
  return Notification.create({
    id: createNotificationId(oid('n1')),
    organizationId: createOrganizationId(oid('org-1')),
    recipientUserId: createUserId(oid('user-a')),
    alertType: 'CASE_ASSIGNED',
    channel: 'EMAIL',
    context: {},
    now: NOW,
  });
}

describe('createMarkNotificationReadUseCase', () => {
  it('flips an UNREAD notification to READ for the recipient', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification());
    const markRead = createMarkNotificationReadUseCase({ repository, clock: fixedClock });

    const result = await markRead({ auth: USER_A, id: oid('n1') });

    expect(result.status).toBe('READ');
    const persisted = await repository.findById(createNotificationId(oid('n1')));
    expect(persisted?.status).toBe('READ');
  });

  it('throws NOTIFICATION_NOT_FOUND for an unknown id', async () => {
    const repository = new InMemoryNotificationRepository();
    const markRead = createMarkNotificationReadUseCase({ repository, clock: fixedClock });

    expect.assertions(2);
    try {
      await markRead({ auth: USER_A, id: oid('missing') });
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as InstanceType<typeof NotificationsError>).code).toBe('NOTIFICATION_NOT_FOUND');
    }
  });

  it('throws NOTIFICATION_FORBIDDEN_NOT_RECIPIENT when the caller is not the recipient', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification());
    const markRead = createMarkNotificationReadUseCase({ repository, clock: fixedClock });

    expect.assertions(3);
    try {
      await markRead({ auth: USER_B, id: oid('n1') });
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as InstanceType<typeof NotificationsError>).code).toBe('NOTIFICATION_FORBIDDEN_NOT_RECIPIENT');
    }
    const persisted = await repository.findById(createNotificationId(oid('n1')));
    expect(persisted?.status).toBe('UNREAD');
  });

  it('is a no-op success when the notification is already READ', async () => {
    const repository = new InMemoryNotificationRepository();
    await repository.save(buildNotification().markRead(NOW));
    const markReadSpy = jest.spyOn(repository, 'markRead');
    const markRead = createMarkNotificationReadUseCase({ repository, clock: fixedClock });

    const result = await markRead({ auth: USER_A, id: oid('n1') });

    expect(result.status).toBe('READ');
    expect(markReadSpy).not.toHaveBeenCalled();
  });
});
