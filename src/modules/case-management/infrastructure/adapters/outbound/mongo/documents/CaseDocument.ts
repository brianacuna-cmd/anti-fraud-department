/**
 * Mongo document shape for `cases`. `_id` is the aggregate's branded `CaseId`
 * stored as a native BSON `ObjectId`. Instant fields are BSON `Date`.
 * `assigned_to` stays a string because it can be a user ObjectId hex or a
 * catalog `RoleId` (`ADMIN`, …).
 */

import type { ObjectId } from 'mongodb';

export interface CaseDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly customer_id: string;
  readonly customer_email: string | null;
  readonly bridge_user_id: string | null;
  readonly bridge_wallet: string | null;
  readonly stripe_customer_id: string | null;
  readonly finturu_reference: Record<string, unknown> | null;
  readonly scoring_evidence: Record<string, unknown> | null;
  readonly idempotency_key: string | null;
  readonly risk_score: number;
  readonly status: string;
  readonly priority: string;
  readonly assigned_to: string | null;
  readonly assigned_to_type: string | null;
  readonly due_date: Date | null;
  readonly tags: readonly string[];
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly deleted_at: Date | null;
}
