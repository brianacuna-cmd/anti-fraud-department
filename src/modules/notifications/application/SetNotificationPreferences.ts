import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { NotificationPreferenceRepository } from '../domain/ports/NotificationPreferenceRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import { NotificationPreference } from '../domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId, type OrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createAlertType, type AlertType } from '../domain/model/value-objects/AlertType.js';
import {
  createNotificationChannel,
  CONFIGURABLE_CHANNELS,
  type NotificationChannel,
} from '../domain/model/value-objects/NotificationChannel.js';
import { channelNotConfigurable, invariantViolation } from '../domain/errors/NotificationsError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface SetNotificationPreferencesEntryInput {
  readonly alertType: string;
  readonly channel: string;
  readonly enabled: boolean;
}

export interface SetNotificationPreferencesInput {
  readonly auth: AuthContext;
  readonly entries: readonly SetNotificationPreferencesEntryInput[];
}

export interface SetNotificationPreferencesDeps {
  readonly repository: NotificationPreferenceRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

interface ValidatedEntry {
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

/**
 * Bulk sibling of `SetNotificationPreference` (design "Bulk atomicity"):
 * validate-all-first, then one `withTransaction` wrapping N upserts + N
 * audit rows. Every entry is resolved and checked against the SAME
 * `CONFIGURABLE_CHANNELS` invariant BEFORE the transaction opens — a single
 * bad entry (unknown alertType/channel, or IN_APP) rejects the WHOLE
 * request with zero writes, because the base `UnitOfWork.withTransaction`
 * fallback runs without real atomicity on a non-replica-set deployment and
 * cannot be relied on to roll back a validation failure.
 */
export function createSetNotificationPreferencesUseCase(deps: SetNotificationPreferencesDeps) {
  return async function setNotificationPreferences(
    input: SetNotificationPreferencesInput,
  ): Promise<NotificationPreference[]> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const userId = createUserId(input.auth.userId);

    if (input.entries.length === 0) {
      throw invariantViolation('entries must not be empty');
    }

    const validated: ValidatedEntry[] = input.entries.map((entry) => {
      const alertType = createAlertType(entry.alertType);
      const channel = createNotificationChannel(entry.channel);
      if (!CONFIGURABLE_CHANNELS.includes(channel as (typeof CONFIGURABLE_CHANNELS)[number])) {
        throw channelNotConfigurable(channel);
      }
      return { alertType, channel, enabled: entry.enabled };
    });

    return deps.unitOfWork.withTransaction(async (tx) => {
      const now = deps.clock.now();
      const saved: NotificationPreference[] = [];

      for (const entry of validated) {
        const desired = NotificationPreference.create({
          organizationId,
          userId,
          alertType: entry.alertType,
          channel: entry.channel,
          enabled: entry.enabled,
          now,
        });
        const persisted = await deps.repository.upsert(desired, tx);
        saved.push(persisted);

        await deps.auditRecorder.record(
          {
            organizationId: organizationId as OrganizationId,
            actorType: input.auth.actorType,
            actorId: input.auth.userId,
            action: 'NOTIFICATION_PREFERENCE_UPDATED',
            resource: 'notificationPreferences',
            resourceId: `${entry.alertType}:${entry.channel}`,
            detail: { alertType: entry.alertType, channel: entry.channel, enabled: persisted.enabled },
            ipAddress: input.auth.ipAddress,
          },
          tx,
        );
      }

      return saved;
    });
  };
}

