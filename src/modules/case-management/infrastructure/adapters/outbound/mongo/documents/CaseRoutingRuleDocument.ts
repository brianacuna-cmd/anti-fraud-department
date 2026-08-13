/**
 * Mongo document shape for `case_routing_rules`. `_id` is the aggregate's
 * branded `CaseRoutingRuleId` stored as a native BSON `ObjectId`. Instant
 * fields are BSON `Date`. `organization_id` is an ObjectId FK.
 *
 * `conditions` stores the full JDM graph for ZEN Engine. `target_user_id` /
 * `target_role_id` are optional fallbacks when the JDM output omits them.
 */

import type { ObjectId } from 'mongodb';

export interface CaseRoutingRuleDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditions_version: number;
  readonly target_role_id: string | null;
  readonly target_user_id: string | null;
  readonly status: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}
