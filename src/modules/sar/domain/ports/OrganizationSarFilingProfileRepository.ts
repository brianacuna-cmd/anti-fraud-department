import type { OrganizationSarFilingProfile } from '../model/aggregates/OrganizationSarFilingProfile.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `organization_sar_filing_profile`.
 *
 * `findByOrganization` returns `null` for a tenant that has not configured
 * filing yet — that is an ordinary state, not an error, and only
 * `GenerateSarReportXml` turns it into one.
 */
export interface OrganizationSarFilingProfileRepository {
  save(profile: OrganizationSarFilingProfile, tx?: Transaction): Promise<void>;
  findByOrganization(
    organizationId: string,
    tx?: Transaction,
  ): Promise<OrganizationSarFilingProfile | null>;
}
