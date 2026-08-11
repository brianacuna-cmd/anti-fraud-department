import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `NotificationPreferences` (design D1/D4). One row
 * per `(OrganizationId, UserId, AlertType, Channel)`, uniqueness enforced by
 * a compound unique index (design D9) — NOT a composite `_id`. `_id` is a
 * driver-generated surrogate `ObjectId`, deliberately never mapped into the
 * domain (identity there IS the natural key, design D1).
 */
export interface NotificationPreferenceDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: string;
  readonly UserId: string;
  readonly AlertType: string;
  readonly Channel: string;
  readonly Enabled: boolean;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}
