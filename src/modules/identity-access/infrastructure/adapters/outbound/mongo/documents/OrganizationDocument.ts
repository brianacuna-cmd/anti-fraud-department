/**
 * Mongo document shape for `organizations`. `_id` is the aggregate's branded
 * `OrganizationId` stored as a native BSON `ObjectId`. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface OrganizationDocument {
  readonly _id: ObjectId;
  readonly name: string;
  readonly slug: string;
  readonly domain: string | null;
  readonly status: string;
  readonly configuration: Record<string, unknown>;
  readonly email: string | null;
  readonly password_hash: string | null;
  readonly login_attempts: number;
  readonly blocked_until: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}
