import { createDeleteUserUseCase } from '../../../../src/modules/identity-access/application/DeleteUser.js';
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
const DELETED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });

async function seedUser(userRepositoryFactory: InMemoryUserRepositoryFactory, id = 'user-1'): Promise<void> {
  const org = createOrganizationId('org-1');
  await userRepositoryFactory.forTenant(org).save(
    User.create({
      id: createUserId(id),
      organizationId: org,
      email: createEmail('alice@example.com'),
      credential: createPasswordCredential('hash', 'salt'),
      firstName: 'Alice',
      lastName: 'Smith',
      now: CREATED_AT,
    }),
  );
}

function buildUseCases(userRepositoryFactory: InMemoryUserRepositoryFactory) {
  const unitOfWork = new InMemoryUnitOfWork();
  const clock = new FixedClock(DELETED_AT);
  const transitionUserStatus = createTransitionUserStatusUseCase({ userRepositoryFactory, unitOfWork, clock });
  const deleteUser = createDeleteUserUseCase({ transitionUserStatus });
  return { transitionUserStatus, deleteUser };
}

describe('createDeleteUserUseCase', () => {
  it('transitions the user to DISABLED', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const { deleteUser } = buildUseCases(userRepositoryFactory);

    const user = await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });

    expect(user.status).toBe('DISABLED');
  });

  it('produces the exact same result as calling transitionUserStatus with next=DISABLED', async () => {
    const factoryForDelete = new InMemoryUserRepositoryFactory();
    await seedUser(factoryForDelete);
    const factoryForTransition = new InMemoryUserRepositoryFactory();
    await seedUser(factoryForTransition);
    const { deleteUser } = buildUseCases(factoryForDelete);
    const { transitionUserStatus } = buildUseCases(factoryForTransition);

    const viaDelete = await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });
    const viaTransition = await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'DISABLED' });

    expect(viaDelete.status).toBe(viaTransition.status);
    expect(viaDelete.updatedAt).toBe(viaTransition.updatedAt);
  });

  it('fails identically to /transition when the user is already DISABLED', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const { deleteUser } = buildUseCases(userRepositoryFactory);
    await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });

    expect.assertions(2);
    try {
      await deleteUser({ auth: ORG_ADMIN, userId: 'user-1' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVALID_TRANSITION');
    }
  });
});
