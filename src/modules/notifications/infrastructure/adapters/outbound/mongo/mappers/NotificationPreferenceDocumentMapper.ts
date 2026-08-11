import { brand } from '../../../../../../../shared/kernel/Brand.js';
import { NotificationPreference } from '../../../../../domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../../../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../../domain/model/value-objects/UserId.js';
import { createAlertType } from '../../../../../domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../../../../../domain/model/value-objects/NotificationChannel.js';
import type { NotificationPreferenceDocument } from '../documents/NotificationPreferenceDocument.js';

/** PascalCase (Mongo) -> camelCase (domain) translation seam (design A2/D4). `_id` is intentionally dropped. */
export function toDomain(document: NotificationPreferenceDocument): NotificationPreference {
  return NotificationPreference.rehydrate({
    organizationId: createOrganizationId(document.OrganizationId),
    userId: createUserId(document.UserId),
    alertType: createAlertType(document.AlertType),
    channel: createNotificationChannel(document.Channel),
    enabled: document.Enabled,
    createdAt: brand<string, 'Instant'>(document.CreatedAt),
    updatedAt: brand<string, 'Instant'>(document.UpdatedAt),
  });
}

export interface UpsertFields {
  readonly key: {
    readonly OrganizationId: string;
    readonly UserId: string;
    readonly AlertType: string;
    readonly Channel: string;
  };
  readonly set: { readonly Enabled: boolean; readonly UpdatedAt: string };
  readonly setOnInsert: { readonly CreatedAt: string };
}

/**
 * Splits a desired post-state into the `$set`/`$setOnInsert` fragments the
 * repository's atomic upsert needs (design D4/D5). `_id` is never written —
 * Mongo generates it on insert.
 */
export function toUpsertFields(pref: NotificationPreference): UpsertFields {
  return {
    key: {
      OrganizationId: pref.organizationId,
      UserId: pref.userId,
      AlertType: pref.alertType,
      Channel: pref.channel,
    },
    set: { Enabled: pref.enabled, UpdatedAt: pref.updatedAt },
    setOnInsert: { CreatedAt: pref.createdAt },
  };
}
