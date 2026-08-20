/**
 * Mongo document shape for `users`. `_id` is the aggregate's branded `UserId`
 * stored as a native BSON `ObjectId`. Instant fields are BSON `Date`.
 */

import type { ObjectId } from 'mongodb';

export interface UserDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly email: string;
  readonly password_hash: string;
  readonly first_name: string;
  readonly middle_name: string | null;
  readonly last_name: string;
  readonly avatar_url: string | null;
  readonly status: string;
  readonly is_platform_admin: boolean;
  readonly role_id: string;
  readonly reset_token: { readonly hash: string; readonly expires_at: Date } | null;
  readonly mfa: { readonly secret: string | null; readonly enabled: boolean; readonly recovery_codes: readonly string[] };
  readonly login_attempts: number;
  readonly blocked_until: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
