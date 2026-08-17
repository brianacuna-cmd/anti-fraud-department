import type { NotificationRequest, NotificationSender } from '../modules/case-management/domain/ports/NotificationSender.js';
import type { Transaction as CaseManagementTransaction } from '../modules/case-management/domain/ports/UnitOfWork.js';
import type { createSendNotificationUseCase } from '../modules/notifications/application/SendNotification.js';
import type { Transaction as NotificationsTransaction } from '../modules/notifications/domain/ports/UnitOfWork.js';
import { createOrganizationId } from '../modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../modules/notifications/domain/model/value-objects/UserId.js';
import { createAlertType } from '../modules/notifications/domain/model/value-objects/AlertType.js';

/**
 * Composition-root bridge (design "Cross-module seams: Notification reuse",
 * exact twin of `caseManagementAuditRecorderAdapter.ts`): implements
 * case-management's OWN `NotificationSender` port by delegating to the
 * `notifications` module's `SendNotification` use case. Lives OUTSIDE every
 * module's `domain`/`application`/`infrastructure` folders — the one legal
 * seam where a cross-module import is allowed by `eslint-plugin-boundaries`.
 *
 * `tx` is case-management's OWN opaque `Transaction`; `sendNotification`
 * wants the `notifications` module's OWN opaque `Transaction`. Both are the
 * same runtime `ClientSession` — this is the single documented cast that
 * bridges the two nominal types for this module, mirroring the audit twin.
 */
export function createCaseManagementNotificationSenderAdapter(
  sendNotification: ReturnType<typeof createSendNotificationUseCase>,
): NotificationSender {
  return {
    async send(request: NotificationRequest, tx?: CaseManagementTransaction): Promise<void> {
      await sendNotification(
        {
          organizationId: createOrganizationId(request.organizationId),
          recipientUserId: createUserId(request.recipientUserId),
          alertType: createAlertType(request.alertType),
          context: request.context,
        },
        tx as unknown as NotificationsTransaction | undefined,
      );
    },
  };
}
