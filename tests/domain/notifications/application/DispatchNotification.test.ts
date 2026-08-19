import { createDispatchNotificationUseCase } from '../../../../src/modules/notifications/application/DispatchNotification.js';
import {
  createListNotificationsUseCase,
  createMarkNotificationReadUseCase,
} from '../../../../src/modules/notifications/application/ListNotifications.js';
import { InMemoryNotificationRepository } from '../../../helpers/notifications/InMemoryNotificationRepository.js';
import { InMemoryNotificationPreferenceRepository } from '../../../helpers/notifications/InMemoryNotificationPreferenceRepository.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../src/modules/notifications/domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';
import { generateNotificationId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { NotificationsError } from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

const NOW = fromDate(new Date('2026-10-01T09:00:00.000Z'));
const LATER = fromDate(new Date('2026-10-01T11:00:00.000Z'));
const ANALYST = createAuthContext({ userId: 'analyst-1', organizationId: 'org-1', actorType: 'USER' });
const OTHER = createAuthContext({ userId: 'analyst-2', organizationId: 'org-1', actorType: 'USER' });

function build() {
  const notifications = new InMemoryNotificationRepository();
  const preferences = new InMemoryNotificationPreferenceRepository();

  const dispatchNotification = createDispatchNotificationUseCase({
    notifications,
    preferences,
    clock: new FixedClock(NOW),
    generateNotificationId,
  });

  return {
    notifications,
    preferences,
    dispatchNotification,
    listNotifications: createListNotificationsUseCase({ notifications }),
    markNotificationRead: createMarkNotificationReadUseCase({ notifications, clock: new FixedClock(LATER) }),
  };
}

const baseInput = {
  organizationId: 'org-1',
  recipientUserId: 'analyst-1',
  alertType: 'CASO_ASIGNADO',
  title: 'Se te ha asignado un expediente',
  body: 'El caso X esta ahora a tu nombre.',
  resourceType: 'case',
  resourceId: 'case-1',
};

function disable(
  preferences: InMemoryNotificationPreferenceRepository,
  channel: string,
  alertType = 'CASO_ASIGNADO',
) {
  preferences.seed(
    NotificationPreference.create({
      organizationId: createOrganizationId('org-1'),
      userId: createUserId('analyst-1'),
      alertType: createAlertType(alertType),
      channel: createNotificationChannel(channel),
      enabled: false,
      now: NOW,
    }),
  );
}

describe('createDispatchNotificationUseCase', () => {
  it('delivers to the in-app inbox by default', async () => {
    const { dispatchNotification, notifications } = build();

    const delivered = await dispatchNotification(baseInput);

    expect(delivered).toHaveLength(1);
    expect(notifications.all()).toHaveLength(1);
    expect(notifications.all()[0]?.channel).toBe('IN_APP');
    expect(notifications.all()[0]?.isRead).toBe(false);
    expect(notifications.all()[0]?.resourceId).toBe('case-1');
  });

  it('delivers when the user has never touched their preferences', async () => {
    // Ausencia de fila significa SI: tratarla como "no quiere" dejaria sin
    // avisar justamente a quien no ha configurado nada, que es la mayoria.
    const { dispatchNotification } = build();

    await expect(dispatchNotification({ ...baseInput, channels: ['EMAIL'] })).resolves.toHaveLength(1);
  });

  it('honours an explicit opt-out for email', async () => {
    const { dispatchNotification, preferences } = build();
    disable(preferences, 'EMAIL');

    await expect(dispatchNotification({ ...baseInput, channels: ['EMAIL'] })).resolves.toHaveLength(0);
  });

  it('still delivers in-app even when that channel is explicitly disabled', async () => {
    // La bandeja no es silenciable: sin constancia de aviso, "no me enteré"
    // deja de ser verificable.
    const { dispatchNotification, notifications, preferences } = build();
    disable(preferences, 'IN_APP');

    await dispatchNotification({ ...baseInput, channels: ['IN_APP'] });

    expect(notifications.all()).toHaveLength(1);
  });

  it('applies each channel opt-out independently', async () => {
    const { dispatchNotification, preferences } = build();
    disable(preferences, 'EMAIL');

    const delivered = await dispatchNotification({ ...baseInput, channels: ['IN_APP', 'EMAIL'] });

    expect(delivered.map((n) => n.channel)).toEqual(['IN_APP']);
  });

  it('never throws on a bad alert type — the notice is the echo, not the fact', async () => {
    const { dispatchNotification, notifications } = build();

    await expect(dispatchNotification({ ...baseInput, alertType: 'NO_EXISTE' })).resolves.toEqual([]);
    expect(notifications.all()).toHaveLength(0);
  });
});

describe('notification inbox', () => {
  it('lists only the caller own notifications', async () => {
    const { dispatchNotification, listNotifications } = build();
    await dispatchNotification(baseInput);
    await dispatchNotification({ ...baseInput, recipientUserId: 'analyst-2' });

    const page = await listNotifications({ auth: ANALYST });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.recipientUserId).toBe('analyst-1');
  });

  it('reports the unread count alongside the list', async () => {
    const { dispatchNotification, listNotifications } = build();
    await dispatchNotification(baseInput);
    await dispatchNotification(baseInput);

    const page = await listNotifications({ auth: ANALYST });

    expect(page.items).toHaveLength(2);
    expect(page.unreadCount).toBe(2);
  });

  it('marks one as read and keeps the timestamp of the first read', async () => {
    const { dispatchNotification, listNotifications, markNotificationRead } = build();
    const [notification] = await dispatchNotification(baseInput);

    const read = await markNotificationRead({ auth: ANALYST, notificationId: notification!.id });
    expect(read.readAt).toBe(LATER);

    // Idempotente: volver a marcar no reescribe cuando se entero.
    const again = await markNotificationRead({ auth: ANALYST, notificationId: notification!.id });
    expect(again.readAt).toBe(LATER);

    await expect(listNotifications({ auth: ANALYST })).resolves.toMatchObject({ unreadCount: 0 });
  });

  it('filters to unread only while still counting them all', async () => {
    const { dispatchNotification, listNotifications, markNotificationRead } = build();
    const [first] = await dispatchNotification(baseInput);
    await dispatchNotification(baseInput);
    await markNotificationRead({ auth: ANALYST, notificationId: first!.id });

    const page = await listNotifications({ auth: ANALYST, unreadOnly: true });

    expect(page.items).toHaveLength(1);
    expect(page.unreadCount).toBe(1);
  });

  it('refuses to let one analyst mark another notification read', async () => {
    const { dispatchNotification, markNotificationRead } = build();
    const [notification] = await dispatchNotification(baseInput);

    await expect(
      markNotificationRead({ auth: OTHER, notificationId: notification!.id }),
    ).rejects.toThrow(NotificationsError);
  });
});
