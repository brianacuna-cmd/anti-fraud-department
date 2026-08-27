import type { Transaction } from './UnitOfWork.js';

export interface CaseNotification {
  readonly organizationId: string;
  readonly recipientUserId: string;
  /** Type from the closed `notifications` catalog (e.g. CASE_ASSIGNED). */
  readonly alertType: string;
  readonly title: string;
  readonly body: string;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
}

/**
 * Case-management's own port for notifying a person.
 *
 * Declared here and not imported from the `notifications` module for the
 * same reason as `AuditRecorder`: one module does not depend on another, and
 * the bridge is wired in the composition root.
 *
 * `notify` returns nothing and does not fail: notifying is the echo of a
 * fact, not the fact. If the notice does not go out, the reassignment or
 * the SLA expiry that motivated it is still true and must persist the same.
 */
export interface Notifier {
  notify(notification: CaseNotification, tx?: Transaction): Promise<void>;
}
