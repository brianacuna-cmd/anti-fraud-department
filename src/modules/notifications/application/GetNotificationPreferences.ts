import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { NotificationPreferenceRepository } from '../domain/ports/NotificationPreferenceRepository.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { ALERT_TYPES, type AlertType } from '../domain/model/value-objects/AlertType.js';
import { CONFIGURABLE_CHANNELS, type NotificationChannel } from '../domain/model/value-objects/NotificationChannel.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetNotificationPreferencesInput {
  readonly auth: AuthContext;
}

export interface NotificationPreferenceMatrixEntry {
  readonly alertType: AlertType;
  readonly channel: NotificationChannel;
  readonly enabled: boolean;
}

export interface GetNotificationPreferencesDeps {
  readonly repository: NotificationPreferenceRepository;
}

/**
 * Synthesizes the default-ON effective 4x1 (AlertType x EMAIL) matrix in the
 * application layer (design D7). Read-only, no transaction, no audit — the
 * defaulting logic lives HERE, never in the repository, because a missing
 * row is a real, queryable absence (default-ON).
 */
export function createGetNotificationPreferencesUseCase(deps: GetNotificationPreferencesDeps) {
  return async function getNotificationPreferences(
    input: GetNotificationPreferencesInput,
  ): Promise<NotificationPreferenceMatrixEntry[]> {
    const organizationId = createOrganizationId(requireTenantContext(input.auth));
    const userId = createUserId(input.auth.userId);

    const rows = await deps.repository.findByUser(organizationId, userId);

    return ALERT_TYPES.flatMap((alertType) =>
      CONFIGURABLE_CHANNELS.map((channel) => {
        const row = rows.find((candidate) => candidate.alertType === alertType && candidate.channel === channel);
        return {
          alertType,
          channel,
          enabled: row ? row.enabled : true,
        };
      }),
    );
  };
}
