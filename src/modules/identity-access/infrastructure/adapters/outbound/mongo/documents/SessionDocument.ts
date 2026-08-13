/**
 * Mongo document for `sessions`. `_id` is BSON `ObjectId`. Instant fields are
 * BSON `Date`. Collection and field keys are snake_case.
 */

import type { ObjectId } from 'mongodb';

export interface SessionDocument {
  readonly _id: ObjectId;
  readonly user_id: ObjectId | null;
  readonly organization_id: ObjectId | null;
  readonly admin_organization_id: ObjectId | null;
  readonly token_hash: string;
  readonly ip_address: string | null;
  readonly user_agent: string | null;
  readonly expira_en: Date;
  readonly created_at: Date;
  readonly deleted_at: Date | null;
}
