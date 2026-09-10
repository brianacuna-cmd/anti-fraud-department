import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { AlertType } from '../model/value-objects/AlertType.js';

export interface NotificationWebhookInput {
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly context: Record<string, unknown>;
}

/**
 * Outbound port for delivering a notification to the org's Slack-compatible
 * webhook destination (spec Req 2, design PR2). The composition adapter
 * resolves the org's `webhookUrl` via `NotificationOrgConfigRepository` and
 * POSTs a generic JSON payload; when no URL is configured, sending is a
 * best-effort no-op. Mirrors `NotificationEmailSender`'s shape exactly:
 * delivery is best-effort and throws on failure — `SendNotification` treats
 * a thrown error as a non-fatal, observable failure (PR3) and never rolls
 * back the caller's transaction because of a webhook failure.
 */
export interface NotificationWebhookSender {
  send(input: NotificationWebhookInput): Promise<void>;
}
