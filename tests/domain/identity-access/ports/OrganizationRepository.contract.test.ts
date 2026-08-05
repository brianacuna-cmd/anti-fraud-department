import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import type { OrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildOrganization(id: string, slug: string): Organization {
  return Organization.create({
    id: createOrganizationId(id),
    name: `Org ${id}`,
    slug: createSlug(slug),
    now: NOW,
  });
}

describe('OrganizationRepository (port contract, via InMemoryOrganizationRepository fake)', () => {
  it('returns null from findById when nothing has been saved', async () => {
    const repository = new InMemoryOrganizationRepository();

    const result = await repository.findById(createOrganizationId('missing'));

    expect(result).toBeNull();
  });

  it('persists and retrieves an organization by id', async () => {
    const repository = new InMemoryOrganizationRepository();
    const organization = buildOrganization('org-1', 'acme');
    await repository.save(organization);

    const found = await repository.findById(createOrganizationId('org-1'));

    expect(found?.id).toBe('org-1');
    expect(found?.slug).toBe('acme');
  });

  it('retrieves an organization by slug', async () => {
    const repository = new InMemoryOrganizationRepository();
    await repository.save(buildOrganization('org-1', 'acme'));

    const found = await repository.findBySlug(createSlug('acme'));

    expect(found?.id).toBe('org-1');
  });

  it('returns null from findBySlug when no organization has that slug', async () => {
    const repository = new InMemoryOrganizationRepository();
    await repository.save(buildOrganization('org-1', 'acme'));

    const found = await repository.findBySlug(createSlug('globex'));

    expect(found).toBeNull();
  });

  it('overwrites the stored organization when saving the same id again', async () => {
    const repository = new InMemoryOrganizationRepository();
    await repository.save(buildOrganization('org-1', 'acme'));
    const suspended = (await repository.findById(createOrganizationId('org-1')))!.transitionTo(
      'SUSPENDED',
      { isPlatformAdmin: true },
      NOW,
    );

    await repository.save(suspended);

    const found = await repository.findById(createOrganizationId('org-1'));
    expect(found?.status).toBe('SUSPENDED');
  });

  describe('list', () => {
    it('returns all items and a null cursor when fewer results exist than the limit', async () => {
      const repository = new InMemoryOrganizationRepository();
      await repository.save(buildOrganization('org-1', 'acme'));
      await repository.save(buildOrganization('org-2', 'globex'));

      const page = await repository.list(10);

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('paginates: returns exactly `limit` items plus a usable next cursor when more exist', async () => {
      const repository = new InMemoryOrganizationRepository();
      await repository.save(buildOrganization('org-1', 'acme'));
      await repository.save(buildOrganization('org-2', 'globex'));
      await repository.save(buildOrganization('org-3', 'initech'));

      const firstPage = await repository.list(2);
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.items.map((organization: Organization) => organization.id as OrganizationId)).toEqual([
        'org-1',
        'org-2',
      ]);
      expect(firstPage.nextCursor).toBe('org-2');

      const secondPage = await repository.list(2, firstPage.nextCursor!);
      expect(secondPage.items.map((organization: Organization) => organization.id as OrganizationId)).toEqual([
        'org-3',
      ]);
      expect(secondPage.nextCursor).toBeNull();
    });
  });
});
