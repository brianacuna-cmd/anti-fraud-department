import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { NotificationPreferenceRepository } from '../domain/ports/NotificationPreferenceRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { NotificationPreference } from '../domain/model/aggregates/NotificationPreference.js';
import { NotificationPreference as NotificationPreferenceAggregate } from '../domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createAlertType } from '../domain/model/value-objects/AlertType.js';
import { createNotificationChannel } from '../domain/model/value-objects/NotificationChannel.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface SetNotificationPreferenceInput {
  readonly auth: AuthContext;
  readonly alertType: string;
  readonly channel: string;
  readonly enabled: boolean;
}

export interface SetNotificationPreferenceDeps {
  readonly repository: NotificationPreferenceRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Atomic single-toggle upsert (design D5). No separate read: `enabled` is an
 * absolute SET from the request, so "read-or-create -> toggle" collapses
 * into one atomic `repository.upsert` call — the create/found branches are
 * handled by the Mongo adapter's `$set`/`$setOnInsert` (PR2), not by an
 * app-layer read here. `userId`/`organizationId` are derived exclusively
 * from `AuthContext` (design D6) — the input contract has no `userId` field,
 * so a spoofed body field can never reach this use case.
 */
export function createSetNotificationPreferenceUseCase(deps: SetNotificationPreferenceDeps) {
  return async function setNotificationPreference(
    input: SetNotificationPreferenceInput,
  ): Promise<NotificationPreference> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const userId = createUserId(input.auth.userId);
    const alertType = createAlertType(input.alertType);
    const channel = createNotificationChannel(input.channel);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const desired = NotificationPreferenceAggregate.create({
        organizationId,
        userId,
        alertType,
        channel,
        enabled: input.enabled,
        now: deps.clock.now(),
      });
      const saved = await deps.repository.upsert(desired, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'NOTIFICATION_PREFERENCE_UPDATED',
          resource: 'notificationPreferences',
          resourceId: `${alertType}:${channel}`,
          detail: { alertType, channel, enabled: saved.enabled },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return saved;
    });
  };
}
