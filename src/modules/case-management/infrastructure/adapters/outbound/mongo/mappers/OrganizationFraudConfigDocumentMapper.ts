import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { OrganizationFraudConfig } from '../../../../../domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../../domain/model/value-objects/OrganizationFraudConfigId.js';
import type { OrganizationFraudConfigDocument } from '../documents/OrganizationFraudConfigDocument.js';

export interface UpsertFields {
  readonly key: { readonly organization_id: ObjectId };
  readonly set: {
    readonly sla_low_minutes: number;
    readonly sla_medium_minutes: number;
    readonly sla_high_minutes: number;
    readonly sla_critical_minutes: number;
    readonly risk_threshold_low: number;
    readonly risk_threshold_medium: number;
    readonly risk_threshold_high: number;
    readonly risk_threshold_critical: number;
    readonly feature_flags: Readonly<Record<string, boolean>>;
    readonly outbound_webhook_url: string | null;
    readonly outbound_webhook_secret: string | null;
    readonly updated_at: Date;
  };
  readonly setOnInsert: { readonly _id: ObjectId; readonly created_at: Date };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs. `_id` is written only via `$setOnInsert`.
 */
export function toUpsertFields(config: OrganizationFraudConfig): UpsertFields {
  return {
    key: { organization_id: new ObjectId(config.organizationId) },
    set: {
      sla_low_minutes: config.slaLowMinutes,
      sla_medium_minutes: config.slaMediumMinutes,
      sla_high_minutes: config.slaHighMinutes,
      sla_critical_minutes: config.slaCriticalMinutes,
      risk_threshold_low: config.riskThresholdLow,
      risk_threshold_medium: config.riskThresholdMedium,
      risk_threshold_high: config.riskThresholdHigh,
      risk_threshold_critical: config.riskThresholdCritical,
      feature_flags: config.featureFlags,
      outbound_webhook_url: config.outboundWebhookUrl,
      outbound_webhook_secret: config.outboundWebhookSecret,
      updated_at: toDate(config.updatedAt),
    },
    setOnInsert: { _id: new ObjectId(config.id), created_at: toDate(config.createdAt) },
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: OrganizationFraudConfigDocument): OrganizationFraudConfig {
  return OrganizationFraudConfig.rehydrate({
    id: createOrganizationFraudConfigId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    slaLowMinutes: document.sla_low_minutes,
    slaMediumMinutes: document.sla_medium_minutes,
    slaHighMinutes: document.sla_high_minutes,
    slaCriticalMinutes: document.sla_critical_minutes,
    riskThresholdLow: document.risk_threshold_low,
    riskThresholdMedium: document.risk_threshold_medium,
    riskThresholdHigh: document.risk_threshold_high,
    riskThresholdCritical: document.risk_threshold_critical,
    featureFlags: document.feature_flags ?? {},
    outboundWebhookUrl: document.outbound_webhook_url ?? null,
    outboundWebhookSecret: document.outbound_webhook_secret ?? null,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
