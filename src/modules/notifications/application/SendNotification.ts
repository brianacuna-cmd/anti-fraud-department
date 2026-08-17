import type { NotificationRepository } from '../domain/ports/NotificationRepository.js';
import type { NotificationPreferenceRepository } from '../domain/ports/NotificationPreferenceRepository.js';
import type { NotificationEmailSender } from '../domain/ports/NotificationEmailSender.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../domain/model/value-objects/UserId.js';
import type { AlertType } from '../domain/model/value-objects/AlertType.js';
import type { NotificationId } from '../domain/model/value-objects/NotificationId.js';
import { Notification } from '../domain/model/aggregates/Notification.js';

export interface SendNotificationInput {
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly context: Record<string, unknown>;
}

export interface SendNotificationDeps {
  readonly notifications: NotificationRepository;
  readonly preferences: NotificationPreferenceRepository;
  readonly clock: Clock;
  readonly generateNotificationId: () => NotificationId;
  /**
   * Optional email transport. When wired, an enabled notification is ALSO
   * delivered by email best-effort AFTER the in-app persist. A send failure
   * is swallowed (reported via `onEmailError`) so it never rolls back the
   * caller's transaction — the in-app row remains the source of truth.
   */
  readonly emailSender?: NotificationEmailSender;
  readonly onEmailError?: (error: unknown) => void;
}

/**
 * Persists an in-app `Notification` row for a machine-to-machine trigger
 * (design ADR-D3). Consults `preferences.findOne(...,'EMAIL')` DIRECTLY —
 * NOT `GetNotificationPreferences` — because there is no recipient
 * `AuthContext` here and only a single (alertType, EMAIL) check is needed.
 * Applies the same default-ON rule locally: a missing preference row means
 * enabled. WHEN the recipient has opted out, suppresses the write entirely
 * and returns without error — the caller's operation still succeeds.
 * Accepts an optional `tx` threaded to BOTH the preference lookup and the
 * save, so the notification commits atomically with the caller's own
 * transaction (e.g. `ReassignCase`'s `withTransaction`).
 */
export function createSendNotificationUseCase(deps: SendNotificationDeps) {
  return async function sendNotification(input: SendNotificationInput, tx?: Transaction): Promise<void> {
    const preference = await deps.preferences.findOne(
      input.organizationId,
      input.recipientUserId,
      input.alertType,
      'EMAIL',
      tx,
    );
    const enabled = preference ? preference.enabled : true;
    if (!enabled) {
      return;
    }

    const now = deps.clock.now();
    const notification = Notification.create({
      id: deps.generateNotificationId(),
      organizationId: input.organizationId,
      recipientUserId: input.recipientUserId,
      alertType: input.alertType,
      channel: 'EMAIL',
      context: input.context,
      now,
    });
    await deps.notifications.save(notification, tx);

    if (deps.emailSender) {
      try {
        await deps.emailSender.send({
          organizationId: input.organizationId,
          recipientUserId: input.recipientUserId,
          alertType: input.alertType,
          context: input.context,
        });
      } catch (error) {
        deps.onEmailError?.(error);
      }
    }
  };
}
