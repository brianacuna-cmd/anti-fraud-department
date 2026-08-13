/**
 * Mongo document shape for `admin_organizations`. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface AdminKeyDocument {
  readonly key_id: ObjectId;
  readonly public_key: string;
  readonly status: string;
  readonly encrypted_private_key: string | null;
  readonly private_key_downloaded_at: Date | null;
  readonly created_at: Date;
  readonly rotated_at: Date | null;
  readonly revoked_at: Date | null;
}

export interface AdminOrganizationDocument {
  readonly _id: ObjectId;
  readonly email: string;
  readonly keys: readonly AdminKeyDocument[];
  readonly created_at: Date;
  readonly updated_at: Date;
}
