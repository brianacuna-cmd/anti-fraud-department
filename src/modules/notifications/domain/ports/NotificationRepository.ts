import type { Notification } from '../model/aggregates/Notification.js';
import type { NotificationId } from '../model/value-objects/NotificationId.js';
import type { NotificationStatus } from '../model/value-objects/NotificationStatus.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { Transaction } from './UnitOfWork.js';

/** Optional filter/pagination for {@link NotificationRepository.findByRecipient}. */
export interface FindByRecipientOptions {
  readonly status?: NotificationStatus;
  readonly limit: number;
  readonly offset: number;
}

/** `{items, total}` page shape, mirroring `caseRouter`/`ListCases`. */
export interface NotificationPage {
  readonly items: readonly Notification[];
  readonly total: number;
}

/**
 * Port for `Notification` persistence.
 *
 * REVISES design D2 ("write-once, insert-only, no mutators") — design D3
 * explicitly breaks that constraint: a single insert-only port cannot serve
 * the inbox list (R3) or mark-read (R4) requirements, so this is an
 * intentional, documented widening of the port, not an oversight.
 */
export interface NotificationRepository {
  save(notification: Notification, tx?: Transaction): Promise<void>;

  /** Self-scoped, newest-first, paginated inbox list (R3). */
  findByRecipient(
    organizationId: OrganizationId,
    recipientUserId: UserId,
    options: FindByRecipientOptions,
    tx?: Transaction,
  ): Promise<NotificationPage>;

  findById(id: NotificationId, tx?: Transaction): Promise<Notification | null>;

  /** Persists the UNREAD → READ transition (R4). */
  markRead(notification: Notification, tx?: Transaction): Promise<void>;
}
