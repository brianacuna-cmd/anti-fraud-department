/**
 * Mongo document shape for `admin_challenges`. `_id` is the `challengeId`
 * (store key, separate from the signed Challenge secret) — a plain string,
 * never an `ObjectId`. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface AdminChallengeDocument {
  readonly _id: string;
  readonly admin_organization_id: ObjectId;
  readonly challenge: string;
  readonly expires_at: Date;
  readonly consumed_at: Date | null;
  readonly created_at: Date;
}
