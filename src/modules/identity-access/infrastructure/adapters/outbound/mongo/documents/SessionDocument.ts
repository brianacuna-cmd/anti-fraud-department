/**
 * Mongo document shape for `sessions`. `_id` is the aggregate's branded
 * `SessionId` stored as a native BSON `ObjectId`. Instant fields are BSON `Date`
 * so TTL can sit on `family_expires_at` directly.
 */

import type { ObjectId } from 'mongodb';

export interface SessionDocument {
  readonly _id: ObjectId;
  readonly user_id: ObjectId | null;
  readonly organization_id: ObjectId | null;
  readonly actor_type: string;
  readonly token_hash: string;
  readonly refresh_token_hash: string | null;
  readonly expires_at: Date;
  readonly refresh_expires_at: Date | null;
  readonly family_id: ObjectId;
  readonly family_expires_at: Date;
  readonly rotated_at: Date | null;
  readonly rotated_from_session_id: ObjectId | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}
