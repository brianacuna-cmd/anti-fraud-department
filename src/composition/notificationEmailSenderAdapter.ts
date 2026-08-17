import type { EmailSender } from '../modules/identity-access/domain/ports/EmailSender.js';
import type { MongoUserRepositoryFactory } from '../modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUserRepositoryFactory.js';
import { createOrganizationId } from '../modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../modules/identity-access/domain/model/value-objects/UserId.js';
import type {
  NotificationEmailInput,
  NotificationEmailSender,
} from '../modules/notifications/domain/ports/NotificationEmailSender.js';

/**
 * Composition bridge (wiring root — allowed to cross module boundaries): adapts
 * the notifications `NotificationEmailSender` port to the shared identity-access
 * `EmailSender`. Resolves the recipient's email address via the tenant-bound
 * `UserRepository` (the notifications module only carries a `recipientUserId`).
 * When the recipient can't be resolved, it skips silently — delivery is
 * best-effort and the in-app notification row is the source of truth.
 */
export function createNotificationEmailSenderAdapter(
  emailSender: EmailSender,
  userRepositoryFactory: MongoUserRepositoryFactory,
  fromAddress: string,
): NotificationEmailSender {
  return {
    async send(input: NotificationEmailInput): Promise<void> {
      const users = userRepositoryFactory.forTenant(createOrganizationId(input.organizationId as string));
      const recipient = await users.findById(createUserId(input.recipientUserId as string));
      if (recipient === null) {
        return;
      }
      await emailSender.send({
        to: recipient.email as string,
        from: fromAddress,
        subject: `Alerta de fraude: ${input.alertType}`,
        text: buildText(input),
      });
    },
  };
}

function buildText(input: NotificationEmailInput): string {
  const details = Object.entries(input.context)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');
  const body = `Tenés una nueva alerta de tipo ${input.alertType}.`;
  return details.length > 0 ? `${body}\n\n${details}` : body;
}
