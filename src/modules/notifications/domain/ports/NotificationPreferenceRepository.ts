import type { NotificationPreference } from '../model/aggregates/NotificationPreference.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { UserId } from '../model/value-objects/UserId.js';
import type { AlertType } from '../model/value-objects/AlertType.js';
import type { NotificationChannel } from '../model/value-objects/NotificationChannel.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Port for `NotificationPreference` persistence (design D3). `upsert` is the
 * single atomic write path (design D5) — there is no separate insert/update:
 * a toggle is an absolute SET of `enabled`, so the Mongo adapter's
 * `findOneAndUpdate(..., { upsert: true })` collapses the create-or-update
 * branch into one round trip.
 */
export interface NotificationPreferenceRepository {
  findByUser(organizationId: OrganizationId, userId: UserId, tx?: Transaction): Promise<NotificationPreference[]>;
  findOne(
    organizationId: OrganizationId,
    userId: UserId,
    alertType: AlertType,
    channel: NotificationChannel,
    tx?: Transaction,
  ): Promise<NotificationPreference | null>;
  /** Returns the persisted post-image (after the upsert). */
  upsert(pref: NotificationPreference, tx: Transaction): Promise<NotificationPreference>;
}
