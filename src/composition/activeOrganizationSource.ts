import type { OrganizationRepository } from '../modules/identity-access/domain/ports/OrganizationRepository.js';
import type { ActiveOrganizationSource } from '../modules/screening/domain/ports/ActiveOrganizationSource.js';

const PAGE_SIZE = 100;

/**
 * Composition bridge: screening ← identity-access (eslint boundaries).
 *
 * Only ACTIVE organizations receive the official lists. A suspended tenant
 * keeps the entries it already has — nothing is deleted on suspension — and
 * catches up on the first night after it is reactivated.
 */
export function createActiveOrganizationSource(
  organizations: Pick<OrganizationRepository, 'list'>,
): ActiveOrganizationSource {
  return {
    async listActiveOrganizationIds(): Promise<readonly string[]> {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await organizations.list(PAGE_SIZE, cursor);
        ids.push(...page.items.filter((organization) => organization.status === 'ACTIVE').map((organization) => String(organization.id)));
        if (page.nextCursor === null) return ids;
        cursor = page.nextCursor;
      }
    },
  };
}
