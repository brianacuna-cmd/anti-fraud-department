import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { OrganizationScreeningConfig } from '../../../../../domain/model/aggregates/OrganizationScreeningConfig.js';
import { createOrganizationScreeningConfigId } from '../../../../../domain/model/value-objects/OrganizationScreeningConfigId.js';
import type { OrganizationScreeningConfigDocument } from '../documents/OrganizationScreeningConfigDocument.js';

export interface UpsertFields {
  readonly key: { readonly organization_id: ObjectId };
  readonly set: {
    readonly alert_threshold: number;
    readonly signal_threshold: number;
    readonly updated_at: Date;
  };
  readonly setOnInsert: { readonly _id: ObjectId; readonly created_at: Date };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs. `_id` is written only via `$setOnInsert`.
 */
export function toUpsertFields(config: OrganizationScreeningConfig): UpsertFields {
  return {
    key: { organization_id: new ObjectId(config.organizationId) },
    set: {
      alert_threshold: config.alertThreshold,
      signal_threshold: config.signalThreshold,
      updated_at: toDate(config.updatedAt),
    },
    setOnInsert: { _id: new ObjectId(config.id), created_at: toDate(config.createdAt) },
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: OrganizationScreeningConfigDocument): OrganizationScreeningConfig {
  return OrganizationScreeningConfig.rehydrate({
    id: createOrganizationScreeningConfigId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    alertThreshold: document.alert_threshold,
    signalThreshold: document.signal_threshold,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
