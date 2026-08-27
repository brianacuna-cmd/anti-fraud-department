/**
 * Mongo document shape for `customer_webhook_subscriptions`. `_id` is the
 * aggregate's branded `CustomerWebhookSubscriptionId` stored as a native BSON
 * `ObjectId`. `organization_id` is an ObjectId FK. Instant fields are BSON
 * `Date`. No secret column — HMAC stays org-level on fraud-config.
 */

import type { ObjectId } from 'mongodb';

export interface CustomerWebhookSubscriptionDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly url: string;
  readonly event_types: readonly string[];
  readonly active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}
