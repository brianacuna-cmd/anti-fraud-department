import { NotificationPreference } from '../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import type { NotificationPreferenceRepository } from '../../../src/modules/notifications/domain/ports/NotificationPreferenceRepository.js';
import type { OrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import type { AlertType } from '../../../src/modules/notifications/domain/model/value-objects/AlertType.js';
import type { NotificationChannel } from '../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';

function keyOf(organizationId: string, userId: string, alertType: string, channel: string): string {
  return `${organizationId}:${userId}:${alertType}:${channel}`;
}

/**
 * In-memory `NotificationPreferenceRepository` fake for application-layer
 * unit tests (design D14, modeled on identity-access's
 * `InMemorySessionRepository`). `upsert` reproduces create-or-replace-by-key
 * semantics so tests can exercise the same "no separate read" collapse the
 * real Mongo adapter's `findOneAndUpdate` guarantees.
 */
export class InMemoryNotificationPreferenceRepository implements NotificationPreferenceRepository {
  private readonly byKey = new Map<string, NotificationPreference>();

  async findByUser(organizationId: OrganizationId, userId: UserId): Promise<NotificationPreference[]> {
    return [...this.byKey.values()].filter(
      (pref) => pref.organizationId === organizationId && pref.userId === userId,
    );
  }

  async findOne(
    organizationId: OrganizationId,
    userId: UserId,
    alertType: AlertType,
    channel: NotificationChannel,
  ): Promise<NotificationPreference | null> {
    return this.byKey.get(keyOf(organizationId, userId, alertType, channel)) ?? null;
  }

  async upsert(pref: NotificationPreference): Promise<NotificationPreference> {
    const key = keyOf(pref.organizationId, pref.userId, pref.alertType, pref.channel);
    this.byKey.set(key, pref);
    return pref;
  }

  /** Test-only seeding helper. */
  seed(pref: NotificationPreference): void {
    this.byKey.set(keyOf(pref.organizationId, pref.userId, pref.alertType, pref.channel), pref);
  }
}
