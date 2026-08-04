import { createTransitionUserStatusUseCase } from '../../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const TRANSITIONED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });
const OTHER_ORG_ADMIN = createAuthContext({ userId: 'u2', organizationId: 'org-2', isPlatformAdmin: false });
const PLATFORM_ADMIN = createAuthContext({ userId: 'u3', organizationId: 'org-1', isPlatformAdmin: true });

async function seedUser(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  status: 'ACTIVO' | 'DESHABILITADO' = 'ACTIVO',
  organizationId = 'org-1',
): Promise<void> {
  const org = createOrganizationId(organizationId);
  let user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash', 'salt'),
    firstName: 'Alice',
    lastName: 'Smith',
    now: CREATED_AT,
  });
  if (status === 'DESHABILITADO') {
    user = user.transitionTo('DESHABILITADO', { isPlatformAdmin: true }, CREATED_AT);
  }
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(userRepositoryFactory: InMemoryUserRepositoryFactory, unitOfWork: InMemoryUnitOfWork) {
  return createTransitionUserStatusUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(TRANSITIONED_AT),
  });
}

describe('createTransitionUserStatusUseCase', () => {
  it('runs the transition inside a unit-of-work transaction and persists the result', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    const user = await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'SUSPENDIDO' });

    expect(user.status).toBe('SUSPENDIDO');
    expect(unitOfWork.transactionCount).toBe(1);
  });

  it('rejects an unknown id with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: ORG_ADMIN, userId: 'missing', next: 'SUSPENDIDO' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects a cross-tenant transition with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'ACTIVO', 'org-1');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: OTHER_ORG_ADMIN, userId: 'user-1', next: 'SUSPENDIDO' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects an org-admin self-reactivating a DESHABILITADO user in their own org with FORBIDDEN_REACTIVATION', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'DESHABILITADO');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'ACTIVO' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_REACTIVATION');
    }
  });

  it('allows a platform-admin to reactivate a DESHABILITADO user', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'DESHABILITADO');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    const user = await transitionUserStatus({ auth: PLATFORM_ADMIN, userId: 'user-1', next: 'ACTIVO' });

    expect(user.status).toBe('ACTIVO');
  });
});
