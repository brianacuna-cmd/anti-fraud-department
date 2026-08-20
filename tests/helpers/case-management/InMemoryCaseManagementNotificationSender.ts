import type { NotificationRequest, NotificationSender } from '../../../src/modules/case-management/domain/ports/NotificationSender.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory `NotificationSender` fake for case-management application-layer tests. */
export class InMemoryCaseManagementNotificationSender implements NotificationSender {
  private readonly requests: Array<{ request: NotificationRequest; tx: Transaction | undefined }> = [];

  async send(request: NotificationRequest, tx?: Transaction): Promise<void> {
    this.requests.push({ request, tx });
  }

  all(): readonly NotificationRequest[] {
    return this.requests.map((entry) => entry.request);
  }
}
