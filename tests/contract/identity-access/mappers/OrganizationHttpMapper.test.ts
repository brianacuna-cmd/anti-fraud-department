import {
  toOrganizationResponse,
  toOrganizationListResponse,
} from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/mappers/OrganizationHttpMapper.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildOrganization(id: string, slug: string): Organization {
  return Organization.create({ id: createOrganizationId(id), name: `Org ${id}`, slug: createSlug(slug), now: NOW });
}

describe('toOrganizationResponse', () => {
  it('maps an Organization aggregate to a plain JSON-serializable DTO', () => {
    const organization = buildOrganization('org-1', 'acme');

    const dto = toOrganizationResponse(organization);

    expect(dto).toEqual({
      id: 'org-1',
      name: 'Org org-1',
      slug: 'acme',
      domain: null,
      status: 'ACTIVE',
      logoUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
});

describe('toOrganizationListResponse', () => {
  it('maps a cursor page of organizations to {items, nextCursor}', () => {
    const page = {
      items: [buildOrganization('org-1', 'acme'), buildOrganization('org-2', 'globex')],
      nextCursor: 'org-2',
    };

    const dto = toOrganizationListResponse(page);

    expect(dto.items).toHaveLength(2);
    expect(dto.items[0]?.id).toBe('org-1');
    expect(dto.nextCursor).toBe('org-2');
  });
});
