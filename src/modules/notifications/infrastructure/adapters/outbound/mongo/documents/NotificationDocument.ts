import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `notifications`. `_id` is the client-minted
 * `NotificationId` hex, stored as `ObjectId` (mirrors `CaseSlaTracking`'s
 * client-minted-id documents — not driver-generated like
 * `NotificationPreferenceDocument`).
 */
export interface NotificationDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly recipient_user_id: ObjectId;
  readonly alert_type: string;
  readonly channel: string;
  readonly context: Record<string, unknown>;
  readonly created_at: Date;
}
