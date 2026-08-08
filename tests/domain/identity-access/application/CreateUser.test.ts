import { createCreateUserUseCase } from '../../../../src/modules/identity-access/application/CreateUser.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
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
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  let nextId = 0;
  const createUser = createCreateUserUseCase({
    userRepositoryFactory,
    passwordHasher,
    unitOfWork,
    clock: new FixedClock(NOW),
    generateId: () => {
      nextId += 1;
      return createUserId(`user-${nextId}`);
    },
    auditRecorder,
  });
  return { createUser, userRepositoryFactory, passwordHasher, unitOfWork, auditRecorder };
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

  it('emits exactly one USER_CREATED audit event inside the transaction', async () => {
    const { createUser, auditRecorder } = buildUseCase();

    const user = await createUser({
      auth: ORG_1_ADMIN,
      email: 'alice@example.com',
      password: 'super-secret',
      firstName: 'Alice',
      lastName: 'Smith',
    });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('USER_CREATED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe(user.id);
    expect(calls[0].event.organizationId).toBe('org-1');
  });

  it('records no audit event when the create fails (duplicate email)', async () => {
    const { createUser, auditRecorder } = buildUseCase();
    await createUser({ auth: ORG_1_ADMIN, email: 'dup@example.com', password: 'pw', firstName: 'A', lastName: 'S' });
    auditRecorder.calls(); // first create recorded one event

    await expect(
      createUser({ auth: ORG_1_ADMIN, email: 'dup@example.com', password: 'pw2', firstName: 'A2', lastName: 'S2' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(auditRecorder.all().filter((e) => e.action === 'USER_CREATED')).toHaveLength(1);
  });
});
