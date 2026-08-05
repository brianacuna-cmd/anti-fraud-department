import { createCreateUserUseCase } from '../../../../src/modules/identity-access/application/CreateUser.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { FakePasswordHasher } from '../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'org-1', isPlatformAdmin: false });
const ORG_2_ADMIN = createAuthContext({ userId: 'u2', organizationId: 'org-2', isPlatformAdmin: false });

function buildUseCase() {
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const passwordHasher = new FakePasswordHasher();
  let nextId = 0;
  const createUser = createCreateUserUseCase({
    userRepositoryFactory,
    passwordHasher,
    clock: new FixedClock(NOW),
    generateId: () => {
      nextId += 1;
      return createUserId(`user-${nextId}`);
    },
  });
  return { createUser, userRepositoryFactory, passwordHasher };
}

describe('createCreateUserUseCase', () => {
  it('creates and persists a new ACTIVE user scoped to the caller\'s organization', async () => {
    const { createUser, userRepositoryFactory, passwordHasher } = buildUseCase();

    const user = await createUser({
      auth: ORG_1_ADMIN,
      email: 'alice@example.com',
      password: 'super-secret',
      firstName: 'Alice',
      lastName: 'Smith',
    });

    expect(user.status).toBe('ACTIVE');
    expect(user.email).toBe('alice@example.com');
    expect(user.credential.passwordHash).toBe('hashed:super-secret');
    expect(passwordHasher.hashCallCount).toBe(1);
    const persisted = await userRepositoryFactory.forTenant(user.organizationId).findById(user.id);
    expect(persisted?.firstName).toBe('Alice');
  });

  it('rejects a duplicate email within the same organization with USER_EMAIL_TAKEN', async () => {
    const { createUser } = buildUseCase();
    await createUser({ auth: ORG_1_ADMIN, email: 'alice@example.com', password: 'pw', firstName: 'A', lastName: 'S' });

    expect.assertions(2);
    try {
      await createUser({ auth: ORG_1_ADMIN, email: 'alice@example.com', password: 'pw2', firstName: 'A2', lastName: 'S2' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_EMAIL_TAKEN');
    }
  });

  it('allows the same email to be used across two different organizations', async () => {
    const { createUser } = buildUseCase();
    await createUser({ auth: ORG_1_ADMIN, email: 'shared@example.com', password: 'pw', firstName: 'A', lastName: 'S' });

    const secondOrgUser = await createUser({
      auth: ORG_2_ADMIN,
      email: 'shared@example.com',
      password: 'pw2',
      firstName: 'B',
      lastName: 'T',
    });

    expect(secondOrgUser.email).toBe('shared@example.com');
    expect(secondOrgUser.organizationId).toBe('org-2');
  });
});
