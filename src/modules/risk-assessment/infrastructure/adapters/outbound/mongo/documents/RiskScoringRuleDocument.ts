/**
 * Mongo document shape for `risk_scoring_rules`. `_id` is the aggregate's
 * branded `RiskScoringRuleId` stored as a native BSON `ObjectId`. Instant
 * fields are BSON `Date`. `organization_id` is an ObjectId FK.
 *
 * `conditions` stores the full JDM graph for ZEN Engine (camelCase keys
 * inside the blob are preserved; only document field names are snake_case).
 */

import type { ObjectId } from 'mongodb';

export interface RiskScoringRuleDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly name: string;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly conditions_version: number;
  readonly status: string;
  /**
   * Optional because documents written before soft delete existed have no
   * such key at all — the mapper's `?? null` is what makes those readable,
   * and a required field here would make that fallback a lie.
   */
  readonly deleted_at?: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
