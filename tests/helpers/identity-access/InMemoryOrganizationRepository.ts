import { buildCursorPage } from '../../../src/shared/http/pagination.js';
import { Organization } from '../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import type {
  OrganizationListPage,
  OrganizationRepository,
} from '../../../src/modules/identity-access/domain/ports/OrganizationRepository.js';
import type { OrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import type { Slug } from '../../../src/modules/identity-access/domain/model/value-objects/Slug.js';

/**
 * In-memory `OrganizationRepository` fake — proves the port's contract
 * without Mongo, and is reused by application-layer use-case unit tests
 * (design Testing Strategy: "in-memory fakes for ports"). Ordering for
 * pagination follows insertion order (a stand-in for Mongo's ascending
 * `_id`), not string sorting.
 */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly byId = new Map<string, Organization>();
  private readonly insertionOrder: string[] = [];

  async save(organization: Organization): Promise<void> {
    const id: string = organization.id;
    if (!this.byId.has(id)) {
      this.insertionOrder.push(id);
    }
    this.byId.set(id, organization);
  }

  async findById(id: OrganizationId): Promise<Organization | null> {
    return this.byId.get(id) ?? null;
  }

  async findBySlug(slug: Slug): Promise<Organization | null> {
    for (const organization of this.byId.values()) {
      if ((organization.slug as string) === (slug as string)) {
        return organization;
      }
    }
    return null;
  }

  async list(limit: number, cursor?: string): Promise<OrganizationListPage> {
    const startIndex = cursor ? this.insertionOrder.indexOf(cursor) + 1 : 0;
    const organizations = this.insertionOrder
      .slice(startIndex)
      .map((id) => this.byId.get(id))
      .filter((organization): organization is Organization => organization !== undefined);

    const wrapped = organizations.map((organization) => ({
      value: organization,
      cursorId: organization.id as string,
    }));
    const page = buildCursorPage(wrapped, limit);
    return { items: page.items.map((entry) => entry.value), nextCursor: page.nextCursor };
  }
}
