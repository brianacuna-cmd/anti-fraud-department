/**
 * Mongo document shape for `organization_fraud_config`. One document per
 * organization, enforced by `org_fraud_config_unique`.
 */

import type { ObjectId } from 'mongodb';

export interface OrganizationFraudConfigDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly sla_low_minutes: number;
  readonly sla_medium_minutes: number;
  readonly sla_high_minutes: number;
  readonly sla_critical_minutes: number;
  readonly risk_threshold_low: number;
  readonly risk_threshold_medium: number;
  readonly risk_threshold_high: number;
  readonly risk_threshold_critical: number;
  readonly feature_flags: Readonly<Record<string, boolean>>;
  /** Present on new writes; legacy docs may omit — mapper defaults to null. */
  readonly outbound_webhook_url?: string | null;
  /** HMAC secret shared with the tenant. Never leaves the API. */
  readonly outbound_webhook_secret?: string | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}
