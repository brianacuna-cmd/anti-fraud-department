import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { NotificationPreference } from '../../../../../domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../../domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../../domain/model/value-objects/NotificationChannel.js';
import type { NotificationPreferenceDocument } from '../documents/NotificationPreferenceDocument.js';

/** snake_case (Mongo) -> camelCase (domain). `_id` is intentionally dropped. */
export function toDomain(document: NotificationPreferenceDocument): NotificationPreference {
  return NotificationPreference.rehydrate({
    organizationId: createOrganizationId(document.organization_id.toString()),
    userId: createUserId(document.user_id.toString()),
    alertType: createAlertType(document.alert_type),
    channel: createNotificationChannel(document.channel),
    enabled: document.enabled,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}

export interface UpsertFields {
  readonly key: {
    readonly organization_id: ObjectId;
    readonly user_id: ObjectId;
    readonly alert_type: string;
    readonly channel: string;
  };
  readonly set: { readonly enabled: boolean; readonly updated_at: Date };
  readonly setOnInsert: { readonly created_at: Date };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs. `_id` is never written — Mongo generates it on insert.
 */
export function toUpsertFields(pref: NotificationPreference): UpsertFields {
  return {
    key: {
      organization_id: new ObjectId(pref.organizationId),
      user_id: new ObjectId(pref.userId),
      alert_type: pref.alertType,
      channel: pref.channel,
    },
    set: { enabled: pref.enabled, updated_at: toDate(pref.updatedAt) },
    setOnInsert: { created_at: toDate(pref.createdAt) },
  };
}
