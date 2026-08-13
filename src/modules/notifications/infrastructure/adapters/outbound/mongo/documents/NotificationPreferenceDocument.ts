import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `notification_preferences`. `_id` is a driver-generated
 * surrogate `ObjectId`, never mapped into the domain.
 */

export interface NotificationPreferenceDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly user_id: ObjectId;
  readonly alert_type: string;
  readonly channel: string;
  readonly enabled: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}
