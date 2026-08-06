import { createDeleteOrganizationUseCase } from '../../../../src/modules/identity-access/application/DeleteOrganization.js';
import { createTransitionOrganizationStatusUseCase } from '../../../../src/modules/identity-access/application/TransitionOrganizationStatus.js';
import { InMemoryOrganizationRepository } from '../../../helpers/identity-access/InMemoryOrganizationRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { Organization } from '../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DELETED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'o0', isPlatformAdmin: true });

async function seedOrganization(organizations: InMemoryOrganizationRepository, id = 'org-1'): Promise<void> {
  await organizations.save(
    Organization.create({ id: createOrganizationId(id), name: 'Acme', slug: createSlug('acme'), now: CREATED_AT }),
  );
}

function buildUseCases(organizations: InMemoryOrganizationRepository) {
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(DELETED_AT);
  const transitionOrganizationStatus = createTransitionOrganizationStatusUseCase({
    organizations,
    unitOfWork,
    clock,
  });
  const deleteOrganization = createDeleteOrganizationUseCase({ transitionOrganizationStatus });
  return { transitionOrganizationStatus, deleteOrganization };
}

describe('createDeleteOrganizationUseCase', () => {
  it('transitions the organization to CANCELLED and sets DeletedAt', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const { deleteOrganization } = buildUseCases(organizations);

    const organization = await deleteOrganization({ auth: PLATFORM_ADMIN, organizationId: 'org-1' });

    expect(organization.status).toBe('CANCELLED');
    expect(organization.deletedAt).toBe(DELETED_AT);
  });

  it('produces the exact same result as calling transitionOrganizationStatus with next=CANCELLED', async () => {
    const organizationsForDelete = new InMemoryOrganizationRepository();
    await seedOrganization(organizationsForDelete, 'org-1');
    const organizationsForTransition = new InMemoryOrganizationRepository();
    await seedOrganization(organizationsForTransition, 'org-1');
    const { deleteOrganization } = buildUseCases(organizationsForDelete);
    const { transitionOrganizationStatus } = buildUseCases(organizationsForTransition);

    const viaDelete = await deleteOrganization({ auth: PLATFORM_ADMIN, organizationId: 'org-1' });
    const viaTransition = await transitionOrganizationStatus({
      auth: PLATFORM_ADMIN,
      organizationId: 'org-1',
      next: 'CANCELLED',
    });

    expect(viaDelete.status).toBe(viaTransition.status);
    expect(viaDelete.updatedAt).toBe(viaTransition.updatedAt);
  });

  it('fails identically to PATCH .../status when the organization is already CANCELLED', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const { deleteOrganization } = buildUseCases(organizations);
    await deleteOrganization({ auth: PLATFORM_ADMIN, organizationId: 'org-1' });

    expect.assertions(2);
    try {
      await deleteOrganization({ auth: PLATFORM_ADMIN, organizationId: 'org-1' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });
});
