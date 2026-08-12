/**
 * Mongo document shape for `OrganizationFraudConfig` (design: "Persistence —
 * collections, documents, mappers"). `_id` is the aggregate's branded
 * `OrganizationFraudConfigId` (a `crypto.randomUUID()` string) — never a
 * driver-generated `ObjectId` (mirrors `CaseDocument`'s ADR-0 override).
 *
 * One document per `OrganizationId` — enforced by the `org_fraud_config_unique`
 * index, never by application-level checks.
 */
export interface OrganizationFraudConfigDocument {
  readonly _id: string;
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
