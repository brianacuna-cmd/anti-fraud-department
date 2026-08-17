import { oid } from '../../../support/oid.js';
import { createSendNotificationUseCase } from '../../../../src/modules/notifications/application/SendNotification.js';
import { InMemoryNotificationRepository } from '../../../helpers/notifications/InMemoryNotificationRepository.js';
import { InMemoryNotificationPreferenceRepository } from '../../../helpers/notifications/InMemoryNotificationPreferenceRepository.js';
import { NotificationPreference } from '../../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { createNotificationId, generateNotificationId } from '../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { Transaction } from '../../../../src/modules/notifications/domain/ports/UnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = createOrganizationId(oid('org-1'));
const USER_1 = createUserId(oid('user-1'));

function buildUseCase() {
  const notifications = new InMemoryNotificationRepository();
  const preferences = new InMemoryNotificationPreferenceRepository();
  const sendNotification = createSendNotificationUseCase({
    notifications,
    preferences,
    clock: new FixedClock(NOW),
    generateNotificationId,
  });
  return { sendNotification, notifications, preferences };
}

describe('createSendNotificationUseCase', () => {
  it('persists a Notification row for an opted-in recipient (no preference row = default ON)', async () => {
    const { sendNotification, notifications } = buildUseCase();

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASO_ASIGNADO',
      context: { caseId: oid('case-1') },
    });

    const rows = notifications.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.alertType).toBe('CASO_ASIGNADO');
    expect(rows[0]?.recipientUserId).toBe(USER_1);
    expect(rows[0]?.channel).toBe('EMAIL');
  });

  it('suppresses the write for an opted-out recipient without throwing', async () => {
    const { sendNotification, notifications, preferences } = buildUseCase();
    preferences.seed(
      NotificationPreference.create({
        organizationId: ORG_1,
        userId: USER_1,
        alertType: 'CASO_ASIGNADO',
        channel: 'EMAIL',
        enabled: false,
        now: NOW,
      }),
    );

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASO_ASIGNADO',
      context: {},
    });

    expect(notifications.all()).toHaveLength(0);
  });

  it('persists when an explicit opted-in preference row exists', async () => {
    const { sendNotification, notifications, preferences } = buildUseCase();
    preferences.seed(
      NotificationPreference.create({
        organizationId: ORG_1,
        userId: USER_1,
        alertType: 'CASO_ASIGNADO',
        channel: 'EMAIL',
        enabled: true,
        now: NOW,
      }),
    );

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASO_ASIGNADO',
      context: {},
    });

    expect(notifications.all()).toHaveLength(1);
  });

  it('threads tx to both the preference lookup and the save', async () => {
    const notifications = new InMemoryNotificationRepository();
    const seenTx: (Transaction | undefined)[] = [];
    const preferences = {
      findOne: async (..._args: unknown[]) => {
        seenTx.push(_args[4] as Transaction | undefined);
        return null;
      },
      findByUser: async () => [],
      upsert: async (pref: NotificationPreference) => pref,
    };
    const savedTx: (Transaction | undefined)[] = [];
    const repo = {
      save: async (_n: unknown, tx?: Transaction) => {
        savedTx.push(tx);
      },
    };
    const sendNotification = createSendNotificationUseCase({
      notifications: repo as unknown as InMemoryNotificationRepository,
      preferences: preferences as never,
      clock: new FixedClock(NOW),
      generateNotificationId,
    });
    const tx = {} as Transaction;

    await sendNotification(
      { organizationId: ORG_1, recipientUserId: USER_1, alertType: 'CASO_ASIGNADO', context: {} },
      tx,
    );

    expect(seenTx[0]).toBe(tx);
    expect(savedTx[0]).toBe(tx);
  });

  it('does not use generateNotificationId output collisions (sanity: id is a valid NotificationId)', async () => {
    const { sendNotification, notifications } = buildUseCase();

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'RIESGO_CRITICO',
      context: {},
    });

    const [row] = notifications.all();
    expect(() => createNotificationId(row!.id)).not.toThrow();
  });
});
