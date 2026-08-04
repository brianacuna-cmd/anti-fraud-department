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
const TRANSITIONED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'o0', isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: 'u2', organizationId: 'o1', isPlatformAdmin: false });

async function seedOrganization(
  organizations: InMemoryOrganizationRepository,
  status: 'ACTIVO' | 'DESHABILITADO' = 'ACTIVO',
): Promise<void> {
  let organization = Organization.create({
    id: createOrganizationId('org-1'),
    name: 'Acme',
    slug: createSlug('acme'),
    now: CREATED_AT,
  });
  if (status === 'DESHABILITADO') {
    organization = organization.transitionTo('DESHABILITADO', { isPlatformAdmin: true }, CREATED_AT);
  }
  await organizations.save(organization);
}

function buildUseCase(organizations: InMemoryOrganizationRepository, unitOfWork: InMemoryUnitOfWork) {
  return createTransitionOrganizationStatusUseCase({
    organizations,
    unitOfWork,
    clock: new FixedClock(TRANSITIONED_AT),
  });
}

describe('createTransitionOrganizationStatusUseCase', () => {
  it('runs the transition inside a unit-of-work transaction and persists the result', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    const organization = await transitionOrganizationStatus({
      auth: PLATFORM_ADMIN,
      organizationId: 'org-1',
      next: 'SUSPENDIDO',
    });

    expect(organization.status).toBe('SUSPENDIDO');
    expect(unitOfWork.transactionCount).toBe(1);
    const persisted = await organizations.findById(createOrganizationId('org-1'));
    expect(persisted?.status).toBe('SUSPENDIDO');
  });

  it('rejects an unknown id with ORGANIZATION_NOT_FOUND', async () => {
    const organizations = new InMemoryOrganizationRepository();
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    expect.assertions(2);
    try {
      await transitionOrganizationStatus({ auth: PLATFORM_ADMIN, organizationId: 'missing', next: 'SUSPENDIDO' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ORGANIZATION_NOT_FOUND');
    }
  });

  it('allows a platform-admin to reactivate a DESHABILITADO organization', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations, 'DESHABILITADO');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    const organization = await transitionOrganizationStatus({
      auth: PLATFORM_ADMIN,
      organizationId: 'org-1',
      next: 'ACTIVO',
    });

    expect(organization.status).toBe('ACTIVO');
    const persisted = await organizations.findById(createOrganizationId('org-1'));
    expect(persisted?.status).toBe('ACTIVO');
  });

  it('rejects a non-platform-admin caller with FORBIDDEN_CROSS_TENANT before touching the aggregate', async () => {
    const organizations = new InMemoryOrganizationRepository();
    await seedOrganization(organizations);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionOrganizationStatus = buildUseCase(organizations, unitOfWork);

    expect.assertions(3);
    try {
      await transitionOrganizationStatus({ auth: REGULAR_USER, organizationId: 'org-1', next: 'SUSPENDIDO' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
    expect(unitOfWork.transactionCount).toBe(0);
  });
});
