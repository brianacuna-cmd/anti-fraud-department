import { ObjectId } from 'mongodb';
import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { OrganizationFraudConfig } from '../../../../../domain/model/aggregates/OrganizationFraudConfig.js';
import { createOrganizationFraudConfigId } from '../../../../../domain/model/value-objects/OrganizationFraudConfigId.js';
import type { OrganizationFraudConfigDocument } from '../documents/OrganizationFraudConfigDocument.js';

/**
 * camelCase (domain) -> PascalCase (Mongo) translation seam (mirrors
 * `CaseDocumentMapper`). `_id` is the sole documented exception and stays
 * lowercase.
 */
export function toDocument(config: OrganizationFraudConfig): OrganizationFraudConfigDocument {
  return {
    _id: new ObjectId(config.id),
    OrganizationId: config.organizationId,
    SlaLowMinutes: config.slaLowMinutes,
    SlaMediumMinutes: config.slaMediumMinutes,
    SlaHighMinutes: config.slaHighMinutes,
    SlaCriticalMinutes: config.slaCriticalMinutes,
    RiskThresholdLow: config.riskThresholdLow,
    RiskThresholdMedium: config.riskThresholdMedium,
    RiskThresholdHigh: config.riskThresholdHigh,
    RiskThresholdCritical: config.riskThresholdCritical,
    FeatureFlags: config.featureFlags,
    CreatedAt: config.createdAt,
    UpdatedAt: config.updatedAt,
  };
}

export interface UpsertFields {
  readonly key: { readonly OrganizationId: string };
  readonly set: {
    readonly SlaLowMinutes: number;
    readonly SlaMediumMinutes: number;
    readonly SlaHighMinutes: number;
    readonly SlaCriticalMinutes: number;
    readonly RiskThresholdLow: number;
    readonly RiskThresholdMedium: number;
    readonly RiskThresholdHigh: number;
    readonly RiskThresholdCritical: number;
    readonly FeatureFlags: Readonly<Record<string, boolean>>;
    readonly UpdatedAt: string;
  };
  readonly setOnInsert: { readonly _id: ObjectId; readonly CreatedAt: string };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs (mirrors
 * `NotificationPreferenceDocumentMapper.toUpsertFields`) — the create/found
 * branches are decided by Mongo itself, never by a prior app-layer read.
 * `_id` is written only via `$setOnInsert` so an update never touches it.
 */
export function toUpsertFields(config: OrganizationFraudConfig): UpsertFields {
  return {
    key: { OrganizationId: config.organizationId },
    set: {
      SlaLowMinutes: config.slaLowMinutes,
      SlaMediumMinutes: config.slaMediumMinutes,
      SlaHighMinutes: config.slaHighMinutes,
      SlaCriticalMinutes: config.slaCriticalMinutes,
      RiskThresholdLow: config.riskThresholdLow,
      RiskThresholdMedium: config.riskThresholdMedium,
      RiskThresholdHigh: config.riskThresholdHigh,
      RiskThresholdCritical: config.riskThresholdCritical,
      FeatureFlags: config.featureFlags,
      UpdatedAt: config.updatedAt,
    },
    setOnInsert: { _id: new ObjectId(config.id), CreatedAt: config.createdAt },
  };
}

/** PascalCase (Mongo) -> camelCase (domain) translation seam (mirrors `CaseDocumentMapper`). */
export function toDomain(document: OrganizationFraudConfigDocument): OrganizationFraudConfig {
  return OrganizationFraudConfig.rehydrate({
    id: createOrganizationFraudConfigId(document._id.toString()),
    organizationId: document.OrganizationId,
    slaLowMinutes: document.SlaLowMinutes,
    slaMediumMinutes: document.SlaMediumMinutes,
    slaHighMinutes: document.SlaHighMinutes,
    slaCriticalMinutes: document.SlaCriticalMinutes,
    riskThresholdLow: document.RiskThresholdLow,
    riskThresholdMedium: document.RiskThresholdMedium,
    riskThresholdHigh: document.RiskThresholdHigh,
    riskThresholdCritical: document.RiskThresholdCritical,
    featureFlags: document.FeatureFlags,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}
