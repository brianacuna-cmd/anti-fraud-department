import { createListOrganizationsUseCase } from '../../../../src/modules/identity-access/application/ListOrganizations.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'o0', isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: 'u2', organizationId: 'o1', isPlatformAdmin: false });

describe('createListOrganizationsUseCase', () => {
  it('returns a cursor page of organizations for a platform-admin', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await organizations.save(
      Organization.create({ id: createOrganizationId('org-1'), name: 'Acme', slug: createSlug('acme'), now: NOW }),
    );
    await organizations.save(
      Organization.create({ id: createOrganizationId('org-2'), name: 'Globex', slug: createSlug('globex'), now: NOW }),
    );
    const listOrganizations = createListOrganizationsUseCase({ organizations });

    const page = await listOrganizations({ auth: PLATFORM_ADMIN, limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('org-1');
  });

  it('rejects a non-platform-admin actor with FORBIDDEN_CROSS_TENANT', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const listOrganizations = createListOrganizationsUseCase({ organizations });

    expect.assertions(2);
    try {
      await listOrganizations({ auth: REGULAR_USER, limit: 25 });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
