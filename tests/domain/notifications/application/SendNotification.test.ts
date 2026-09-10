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
import type {
  NotificationEmailInput,
  NotificationEmailSender,
} from '../../../../src/modules/notifications/domain/ports/NotificationEmailSender.js';
import type {
  NotificationRealtimeInput,
  NotificationRealtimePusher,
} from '../../../../src/modules/notifications/domain/ports/NotificationRealtimePusher.js';

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
      alertType: 'CASE_ASSIGNED',
      context: { caseId: oid('case-1') },
    });

    const rows = notifications.all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.alertType).toBe('CASE_ASSIGNED');
    expect(rows[0]?.recipientUserId).toBe(USER_1);
    expect(rows[0]?.channel).toBe('EMAIL');
  });

  it('suppresses the write for an opted-out recipient without throwing', async () => {
    const { sendNotification, notifications, preferences } = buildUseCase();
    preferences.seed(
      NotificationPreference.create({
        organizationId: ORG_1,
        userId: USER_1,
        alertType: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        enabled: false,
        now: NOW,
      }),
    );

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
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
        alertType: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        enabled: true,
        now: NOW,
      }),
    );

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
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
      { organizationId: ORG_1, recipientUserId: USER_1, alertType: 'CASE_ASSIGNED', context: {} },
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
      alertType: 'CRITICAL_RISK',
      context: {},
    });

    const [row] = notifications.all();
    expect(() => createNotificationId(row!.id)).not.toThrow();
  });
});

describe('createSendNotificationUseCase — email delivery (optional emailSender)', () => {
  function buildWithEmail(emailSender: NotificationEmailSender, onEmailError?: (error: unknown) => void) {
    const notifications = new InMemoryNotificationRepository();
    const preferences = new InMemoryNotificationPreferenceRepository();
    const sendNotification = createSendNotificationUseCase({
      notifications,
      preferences,
      clock: new FixedClock(NOW),
      generateNotificationId,
      emailSender,
      onEmailError,
    });
    return { sendNotification, notifications, preferences };
  }

  it('also delivers an email for an opted-in recipient after the in-app persist', async () => {
    const sent: NotificationEmailInput[] = [];
    const { sendNotification, notifications } = buildWithEmail({
      send: async (input) => {
        sent.push(input);
      },
    });

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
      context: { caseId: oid('case-1') },
    });

    expect(notifications.all()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
    });
  });

  it('does not send an email when the recipient has opted out', async () => {
    const sent: NotificationEmailInput[] = [];
    const { sendNotification, notifications, preferences } = buildWithEmail({
      send: async (input) => {
        sent.push(input);
      },
    });
    preferences.seed(
      NotificationPreference.create({
        organizationId: ORG_1,
        userId: USER_1,
        alertType: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        enabled: false,
        now: NOW,
      }),
    );

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
      context: {},
    });

    expect(notifications.all()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('swallows an email failure via onEmailError without rolling back the in-app row', async () => {
    const errors: unknown[] = [];
    const { sendNotification, notifications } = buildWithEmail(
      {
        send: async () => {
          throw new Error('resend down');
        },
      },
      (error) => errors.push(error),
    );

    await expect(
      sendNotification({
        organizationId: ORG_1,
        recipientUserId: USER_1,
        alertType: 'CASE_ASSIGNED',
        context: {},
      }),
    ).resolves.toBeUndefined();

    expect(notifications.all()).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});

describe('createSendNotificationUseCase — realtime push (optional realtimePusher)', () => {
  function buildWithRealtime(realtimePusher?: NotificationRealtimePusher, onRealtimeError?: (error: unknown) => void) {
    const notifications = new InMemoryNotificationRepository();
    const preferences = new InMemoryNotificationPreferenceRepository();
    const sendNotification = createSendNotificationUseCase({
      notifications,
      preferences,
      clock: new FixedClock(NOW),
      generateNotificationId,
      realtimePusher,
      onRealtimeError,
    });
    return { sendNotification, notifications, preferences };
  }

  it('pushes to the realtime pusher after the in-app persist for an in-scope alert type', async () => {
    const calls: string[] = [];
    const sent: NotificationRealtimeInput[] = [];
    const notifications = new InMemoryNotificationRepository();
    const originalSave = notifications.save.bind(notifications);
    notifications.save = async (...args) => {
      calls.push('save');
      return originalSave(...args);
    };
    const preferences = new InMemoryNotificationPreferenceRepository();
    const sendNotification = createSendNotificationUseCase({
      notifications,
      preferences,
      clock: new FixedClock(NOW),
      generateNotificationId,
      realtimePusher: {
        send: async (input) => {
          calls.push('push');
          sent.push(input);
        },
      },
    });

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
      context: { caseId: oid('case-1') },
    });

    expect(notifications.all()).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
    });
    expect(calls).toEqual(['save', 'push']);
  });

  it('does not push for an out-of-scope alert type (APPROVAL_PENDING)', async () => {
    const sent: NotificationRealtimeInput[] = [];
    const { sendNotification, notifications } = buildWithRealtime({
      send: async (input) => {
        sent.push(input);
      },
    });

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'APPROVAL_PENDING',
      context: {},
    });

    expect(notifications.all()).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it('does not push when the recipient has opted out', async () => {
    const sent: NotificationRealtimeInput[] = [];
    const { sendNotification, notifications, preferences } = buildWithRealtime({
      send: async (input) => {
        sent.push(input);
      },
    });
    preferences.seed(
      NotificationPreference.create({
        organizationId: ORG_1,
        userId: USER_1,
        alertType: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        enabled: false,
        now: NOW,
      }),
    );

    await sendNotification({
      organizationId: ORG_1,
      recipientUserId: USER_1,
      alertType: 'CASE_ASSIGNED',
      context: {},
    });

    expect(notifications.all()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('persists successfully when realtimePusher is undefined (feature not wired)', async () => {
    const { sendNotification, notifications } = buildWithRealtime(undefined);

    await expect(
      sendNotification({
        organizationId: ORG_1,
        recipientUserId: USER_1,
        alertType: 'CASE_ASSIGNED',
        context: {},
      }),
    ).resolves.toBeUndefined();

    expect(notifications.all()).toHaveLength(1);
  });

  it('swallows a realtimePusher failure via onRealtimeError without rolling back the in-app row', async () => {
    const errors: unknown[] = [];
    const { sendNotification, notifications } = buildWithRealtime(
      {
        send: async () => {
          throw new Error('ws gateway down');
        },
      },
      (error) => errors.push(error),
    );

    await expect(
      sendNotification({
        organizationId: ORG_1,
        recipientUserId: USER_1,
        alertType: 'CASE_ASSIGNED',
        context: {},
      }),
    ).resolves.toBeUndefined();

    expect(notifications.all()).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });
});
