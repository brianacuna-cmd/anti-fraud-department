/**
 * Mongo document shape for `CaseRoutingRules` (CASE-002). `_id` is the
 * aggregate's branded `CaseRoutingRuleId` stored as a native `ObjectId`,
 * mirroring `CaseDocument`.
 *
 * `AssignTo`/`AssignToType` are two separate columns, the same split
 * `CaseDocument` uses for `AssignedTo` — the mapper joins them back into the
 * value object.
 *
 * `Conditions` is stored as a nested document rather than flattened columns:
 * it is read whole, never queried field by field, and flattening would force
 * a migration every time a criterion is added.
 */

import type { ObjectId } from 'mongodb';

export interface CaseRoutingRuleConditionsDocument {
  readonly RiskScoreMin?: number;
  readonly RiskScoreMax?: number;
  readonly Priorities?: readonly string[];
  readonly Tags?: readonly string[];
  readonly CustomerEmailDomain?: string;
  readonly HasStripeCustomer?: boolean;
  readonly HasBridgeWallet?: boolean;
}

export interface CaseRoutingRuleDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: string;
  readonly Name: string;
  readonly EvaluationOrder: number;
  readonly Conditions: CaseRoutingRuleConditionsDocument;
  readonly AssignTo: string;
  readonly AssignToType: string;
  readonly Status: string;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}
