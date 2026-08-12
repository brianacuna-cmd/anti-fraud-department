/**
 * Mongo document shape for `OrganizationFraudConfig` (design: "Persistence —
 * collections, documents, mappers"). `_id` is the aggregate's branded
 * `OrganizationFraudConfigId` (a native MongoDB `ObjectId`, mirrors `CaseDocument`).
 *
 * One document per `OrganizationId` — enforced by the `org_fraud_config_unique`
 * index, never by application-level checks.
 */

import type { ObjectId } from "mongodb";

export interface OrganizationFraudConfigDocument {
  readonly _id: ObjectId;
  readonly OrganizationId: string;
  readonly SlaLowMinutes: number;
  readonly SlaMediumMinutes: number;
  readonly SlaHighMinutes: number;
  readonly SlaCriticalMinutes: number;
  readonly RiskThresholdLow: number;
  readonly RiskThresholdMedium: number;
  readonly RiskThresholdHigh: number;
  readonly RiskThresholdCritical: number;
  readonly FeatureFlags: Readonly<Record<string, boolean>>;
  readonly CreatedAt: string;
  readonly UpdatedAt: string;
}
