/**
 * Mongo document shape for `CaseRoutingRules` (design: "Persistence —
 * collections, documents, mappers"). `_id` is the aggregate's branded
 * `CaseRoutingRuleId` (native MongoDB `ObjectId`).
 *
 * `Conditions` stores the full JDM graph for ZEN Engine. `TargetUserId` /
 * `TargetRoleId` are optional fallbacks when the JDM output omits them.
 */

import type { ObjectId } from 'mongodb';

export interface CaseRoutingRuleDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: string;
  readonly Name: string;
  readonly Conditions: Readonly<Record<string, unknown>>;
  readonly ConditionsVersion: number;
  readonly TargetRoleId: string | null;
  readonly TargetUserId: string | null;
  readonly Status: string;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}
