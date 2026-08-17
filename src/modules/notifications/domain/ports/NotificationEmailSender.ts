import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { AlertType } from '../model/value-objects/AlertType.js';

export interface NotificationEmailInput {
  readonly organizationId: OrganizationId;
  readonly recipientUserId: UserId;
  readonly alertType: AlertType;
  readonly context: Record<string, unknown>;
}

/**
 * Outbound port for delivering a notification as an email. The composition
 * adapter resolves the recipient's address (via identity-access) and bridges
 * to the shared `EmailSender`, so `application` stays ignorant of transport
 * and addressing and depends only on its own module's domain (eslint
 * `boundaries`). Delivery is best-effort: `SendNotification` treats a thrown
 * error as a non-fatal, observable failure — the in-app row is the source of
 * truth and the caller's transaction is never rolled back by an email failure.
 */
export interface NotificationEmailSender {
  send(input: NotificationEmailInput): Promise<void>;
}
