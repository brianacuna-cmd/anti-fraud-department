import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { NotificationOrgConfig } from '../../../../../domain/model/aggregates/NotificationOrgConfig.js';
import { createNotificationOrgConfigId } from '../../../../../domain/model/value-objects/NotificationOrgConfigId.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import type { NotificationOrgConfigDocument } from '../documents/NotificationOrgConfigDocument.js';

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: NotificationOrgConfigDocument): NotificationOrgConfig {
  return NotificationOrgConfig.rehydrate({
    id: createNotificationOrgConfigId(document._id.toString()),
    organizationId: createOrganizationId(document.organization_id.toString()),
    webhookUrl: document.webhook_url,
    secret: document.secret,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

export interface UpsertFields {
  readonly key: { readonly organization_id: ObjectId };
  readonly set: { readonly webhook_url: string | null; readonly secret: string | null; readonly updated_at: Date };
  readonly setOnInsert: { readonly _id: ObjectId; readonly created_at: Date };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs.
 */
export function toUpsertFields(config: NotificationOrgConfig): UpsertFields {
  return {
    key: { organization_id: new ObjectId(config.organizationId) },
    set: {
      webhook_url: config.webhookUrl,
      secret: config.secret,
      updated_at: toDate(config.updatedAt),
    },
    setOnInsert: {
      _id: new ObjectId(config.id),
      created_at: toDate(config.createdAt),
    },
  };
}
