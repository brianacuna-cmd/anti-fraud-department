/**
 * Mongo document shape for `audit_logs`. Append-only. `organization_id` is
 * BSON `ObjectId` when present. `actor_id`/`resource_id` stay strings because
 * they are cross-module and may not be ObjectIds (e.g. failed login).
 */

import type { ObjectId } from 'mongodb';

export interface AuditLogDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId | null;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly action: string;
  readonly resource: string;
  readonly resource_id: string | null;
  readonly detail: Record<string, unknown>;
  readonly ip_address: string | null;
  readonly created_at: Date;
}
