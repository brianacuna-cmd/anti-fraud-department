import { oid } from '../../../support/oid.js';
import { createGetOrganizationUseCase } from '../../../../src/modules/identity-access/application/GetOrganization.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: oid('u1'), organizationId: oid('o0'), isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: oid('u2'), organizationId: oid('o1'), isPlatformAdmin: false });

describe('createGetOrganizationUseCase', () => {
  it('returns the organization for a platform-admin', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await organizations.save(
      Organization.create({ id: createOrganizationId(oid('org-1')), name: 'Acme', slug: createSlug('acme'), now: NOW }),
    );
    const getOrganization = createGetOrganizationUseCase({ organizations });

    const organization = await getOrganization({ auth: PLATFORM_ADMIN, organizationId: oid('org-1') });

    expect(organization.name).toBe('Acme');
  });

  it('rejects an unknown id with ORGANIZATION_NOT_FOUND', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const getOrganization = createGetOrganizationUseCase({ organizations });

    expect.assertions(2);
    try {
      await getOrganization({ auth: PLATFORM_ADMIN, organizationId: oid('missing') });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_NOT_FOUND');
    }
  });

  it('rejects a non-platform-admin actor with FORBIDDEN_CROSS_TENANT', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const getOrganization = createGetOrganizationUseCase({ organizations });

    expect.assertions(2);
    try {
      await getOrganization({ auth: REGULAR_USER, organizationId: oid('org-1') });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
