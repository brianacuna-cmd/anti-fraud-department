import { createPatchOrganizationIdentityUseCase } from '../../../../src/modules/identity-access/application/PatchOrganizationIdentity.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const PATCHED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'o0', isPlatformAdmin: true });

async function seedOrganization(organizations: InMemoryOrganizationRepository): Promise<void> {
  await organizations.save(
    Organization.create({
      id: createOrganizationId('org-1'),
      name: 'Acme',
      slug: createSlug('acme'),
      now: CREATED_AT,
    }),
  );
}

describe('createPatchOrganizationIdentityUseCase', () => {
  it('updates name and logoUrl while leaving slug unchanged', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const patchOrganizationIdentity = createPatchOrganizationIdentityUseCase({
      organizations,
      clock: new FixedClock(PATCHED_AT),
    });

    const updated = await patchOrganizationIdentity({
      auth: PLATFORM_ADMIN,
      organizationId: 'org-1',
      name: 'Acme Corp',
      logoUrl: 'https://acme.com/logo.png',
    });

    expect(updated.name).toBe('Acme Corp');
    expect(updated.logoUrl).toBe('https://acme.com/logo.png');
    expect(updated.slug).toBe('acme');
    expect(updated.updatedAt).toBe(PATCHED_AT);
  });

  it('rejects an unknown id with ORGANIZATION_NOT_FOUND', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const patchOrganizationIdentity = createPatchOrganizationIdentityUseCase({
      organizations,
      clock: new FixedClock(PATCHED_AT),
    });

    expect.assertions(2);
    try {
      await patchOrganizationIdentity({ auth: PLATFORM_ADMIN, organizationId: 'missing', name: 'X' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_NOT_FOUND');
    }
  });
});
