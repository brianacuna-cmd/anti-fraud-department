/**
 * Mongo document shape for `mfa_challenges`. `_id` is the token `jti` — a
 * plain string, never an `ObjectId`, so consume can match on `{_id, ...}`
 * with no secondary lookup. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface MfaChallengeDocument {
  readonly _id: string;
  readonly user_id: ObjectId;
  readonly organization_id: ObjectId | null;
  readonly actor_type: string;
  readonly token_type: string;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
  readonly created_at: Date;
}
