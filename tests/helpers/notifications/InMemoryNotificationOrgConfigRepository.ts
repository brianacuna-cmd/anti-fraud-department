import { NotificationOrgConfig } from '../../../src/modules/notifications/domain/model/aggregates/NotificationOrgConfig.js';
import type { NotificationOrgConfigRepository } from '../../../src/modules/notifications/domain/ports/NotificationOrgConfigRepository.js';
import type { OrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';

/**
 * In-memory `NotificationOrgConfigRepository` fake for application-layer
 * unit tests (modeled on `InMemoryNotificationPreferenceRepository`).
 */
export class InMemoryNotificationOrgConfigRepository implements NotificationOrgConfigRepository {
  private readonly byOrg = new Map<string, NotificationOrgConfig>();

  async upsert(config: NotificationOrgConfig): Promise<void> {
    this.byOrg.set(config.organizationId, config);
  }

  async findByOrganization(organizationId: OrganizationId): Promise<NotificationOrgConfig | null> {
    return this.byOrg.get(organizationId) ?? null;
  }

  /** Test-only seeding helper. */
  seed(config: NotificationOrgConfig): void {
    this.byOrg.set(config.organizationId, config);
  }
}
