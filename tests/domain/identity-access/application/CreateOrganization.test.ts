import { createCreateOrganizationUseCase } from '../../../../src/modules/identity-access/application/CreateOrganization.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'o0', isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: 'u2', organizationId: 'o1', isPlatformAdmin: false });

function buildUseCase() {
  const organizations = new InMemoryOrganizationRepository();
  const clock = new FixedClock(NOW);
  let nextId = 0;
  const createOrganization = createCreateOrganizationUseCase({
    organizations,
    clock,
    generateId: () => {
      nextId += 1;
      return createOrganizationId(`org-${nextId}`);
    },
  });
  return { createOrganization, organizations };
}

describe('createCreateOrganizationUseCase', () => {
  it('creates and persists a new ACTIVE organization for a platform-admin', async () => {
    const { createOrganization, organizations } = buildUseCase();

    const organization = await createOrganization({
      auth: PLATFORM_ADMIN,
      name: 'Acme Corp',
      slug: 'acme-corp',
    });

    expect(organization.status).toBe('ACTIVE');
    expect(organization.slug).toBe('acme-corp');
    const persisted = await organizations.findBySlug(createSlug('acme-corp'));
    expect(persisted?.name).toBe('Acme Corp');
  });

  it('rejects a duplicate slug with ORGANIZATION_SLUG_TAKEN', async () => {
    const { createOrganization } = buildUseCase();
    await createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp', slug: 'acme-corp' });

    expect.assertions(2);
    try {
      await createOrganization({ auth: PLATFORM_ADMIN, name: 'Acme Corp 2', slug: 'acme-corp' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_SLUG_TAKEN');
    }
  });

  it('rejects a non-platform-admin actor with FORBIDDEN_CROSS_TENANT', async () => {
    const { createOrganization } = buildUseCase();

    expect.assertions(2);
    try {
      await createOrganization({ auth: REGULAR_USER, name: 'Acme Corp', slug: 'acme-corp' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
