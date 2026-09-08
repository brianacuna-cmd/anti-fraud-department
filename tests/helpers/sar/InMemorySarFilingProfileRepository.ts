import type { OrganizationSarFilingProfile } from '../../../src/modules/sar/domain/model/aggregates/OrganizationSarFilingProfile.js';
import type { OrganizationSarFilingProfileRepository } from '../../../src/modules/sar/domain/ports/OrganizationSarFilingProfileRepository.js';

/** In-memory `organization_sar_filing_profile`, keyed by organization. */
export class InMemorySarFilingProfileRepository implements OrganizationSarFilingProfileRepository {
  private readonly byOrganization = new Map<string, OrganizationSarFilingProfile>();

  async save(profile: OrganizationSarFilingProfile): Promise<void> {
    this.byOrganization.set(profile.organizationId, profile);
  }

  async findByOrganization(organizationId: string): Promise<OrganizationSarFilingProfile | null> {
    return this.byOrganization.get(organizationId) ?? null;
  }

  all(): OrganizationSarFilingProfile[] {
    return [...this.byOrganization.values()];
  }
}
