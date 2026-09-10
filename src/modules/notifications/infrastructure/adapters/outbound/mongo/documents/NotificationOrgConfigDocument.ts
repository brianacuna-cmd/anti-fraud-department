import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `notification_org_config`. `_id` is a
 * driver-generated surrogate `ObjectId`, never mapped into the domain.
 */
export interface NotificationOrgConfigDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly webhook_url: string | null;
  readonly secret: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
