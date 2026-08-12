import type { OrganizationFraudConfig } from '../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import type { OrganizationFraudConfigRepository } from '../../../src/modules/case-management/domain/ports/OrganizationFraudConfigRepository.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory fake for unit-testing application use cases (mirrors identity-access/notifications fakes). */
export class InMemoryOrganizationFraudConfigRepository implements OrganizationFraudConfigRepository {
  private readonly byOrganization = new Map<string, OrganizationFraudConfig>();

  seed(config: OrganizationFraudConfig): void {
    this.byOrganization.set(config.organizationId, config);
  }

  async upsert(config: OrganizationFraudConfig, _tx?: Transaction): Promise<void> {
    this.byOrganization.set(config.organizationId, config);
  }

  async findByOrganization(organizationId: string, _tx?: Transaction): Promise<OrganizationFraudConfig | null> {
    return this.byOrganization.get(organizationId) ?? null;
  }
}
