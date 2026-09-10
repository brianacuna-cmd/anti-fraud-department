import type { NotificationRepository } from '../domain/ports/NotificationRepository.js';
import type { NotificationPreferenceRepository } from '../domain/ports/NotificationPreferenceRepository.js';
import type { NotificationEmailSender } from '../domain/ports/NotificationEmailSender.js';
import type { NotificationRealtimePusher } from '../domain/ports/NotificationRealtimePusher.js';
import type { NotificationWebhookSender } from '../domain/ports/NotificationWebhookSender.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../domain/model/value-objects/UserId.js';
import type { AlertType } from '../domain/model/value-objects/AlertType.js';
import type { NotificationId } from '../domain/model/value-objects/NotificationId.js';
import type { NotificationChannel } from '../domain/model/value-objects/NotificationChannel.js';
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
   * Optional email transport. When wired, an enabled EMAIL preference
   * delivers best-effort AFTER the in-app persist. A send failure is
   * swallowed (reported via `onEmailError`) so it never rolls back the
   * caller's transaction — the in-app row remains the source of truth.
   */
  readonly emailSender?: NotificationEmailSender;
  readonly onEmailError?: (error: unknown) => void;
  /**
   * Optional realtime WS transport. When wired AND the alert type is in
   * `REALTIME_ALERT_TYPES`, a push is attempted best-effort AFTER persist,
   * independently of EMAIL/SLACK/WEBHOOK preferences. A push failure is
   * swallowed via `onRealtimeError`.
   */
  readonly realtimePusher?: NotificationRealtimePusher;
  readonly onRealtimeError?: (error: unknown) => void;
  /**
   * Optional org webhook transport (Slack-compatible JSON). Fires at most
   * once when SLACK or WEBHOOK preference is enabled (default-ON if the
   * row is missing). Failures are swallowed via `onWebhookError`.
   */
  readonly webhookSender?: NotificationWebhookSender;
  readonly onWebhookError?: (error: unknown) => void;
}

/** Alert types that trigger a realtime push in v1 (spec Requirement 3). */
const REALTIME_ALERT_TYPES: ReadonlySet<AlertType> = new Set<AlertType>(['CASE_ASSIGNED', 'SLA_DUE_SOON', 'CRITICAL_RISK']);

async function isChannelEnabled(
  preferences: NotificationPreferenceRepository,
  input: SendNotificationInput,
  channel: NotificationChannel,
  tx?: Transaction,
): Promise<boolean> {
  const preference = await preferences.findOne(
    input.organizationId,
    input.recipientUserId,
    input.alertType,
    channel,
    tx,
  );
  return preference ? preference.enabled : true;
}

/**
 * Persists an in-app `Notification` row unconditionally (`channel: 'IN_APP'`),
 * then fans out independently to email, realtime, and webhook.
 * Preference lookups use default-ON when the row is missing and thread `tx`.
 */
export function createSendNotificationUseCase(deps: SendNotificationDeps) {
  return async function sendNotification(input: SendNotificationInput, tx?: Transaction): Promise<void> {
    const now = deps.clock.now();
    const notification = Notification.create({
      id: deps.generateNotificationId(),
      organizationId: input.organizationId,
      recipientUserId: input.recipientUserId,
      alertType: input.alertType,
      channel: 'IN_APP',
      context: input.context,
      now,
    });
    await deps.notifications.save(notification, tx);

    if (deps.emailSender && (await isChannelEnabled(deps.preferences, input, 'EMAIL', tx))) {
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

    if (deps.realtimePusher && REALTIME_ALERT_TYPES.has(input.alertType)) {
      try {
        await deps.realtimePusher.send({
          organizationId: input.organizationId,
          recipientUserId: input.recipientUserId,
          alertType: input.alertType,
          context: input.context,
        });
      } catch (error) {
        deps.onRealtimeError?.(error);
      }
    }

    if (deps.webhookSender) {
      const slackEnabled = await isChannelEnabled(deps.preferences, input, 'SLACK', tx);
      const webhookEnabled = await isChannelEnabled(deps.preferences, input, 'WEBHOOK', tx);
      if (slackEnabled || webhookEnabled) {
        try {
          await deps.webhookSender.send({
            organizationId: input.organizationId,
            recipientUserId: input.recipientUserId,
            alertType: input.alertType,
            context: input.context,
          });
        } catch (error) {
          deps.onWebhookError?.(error);
        }
      }
    }
  };
}
