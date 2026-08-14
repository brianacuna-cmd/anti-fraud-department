import { createCreateUserUseCase } from '../../../../src/modules/identity-access/application/CreateUser.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakePasswordHasher } from '../../../helpers/identity-access/FakePasswordHasher.js';
import { InMemoryRoleRepository, withRoles, buildRoleView } from '../../../helpers/identity-access/InMemoryRoleRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'org-1', actorType: 'ORGANIZATION' });
const ORG_2_ADMIN = createAuthContext({ userId: 'u2', organizationId: 'org-2', actorType: 'ORGANIZATION' });
const ORG_1_USER = createAuthContext({ userId: 'u3', organizationId: 'org-1', isPlatformAdmin: false });

function buildUseCase() {
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const passwordHasher = new FakePasswordHasher();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const roleRepository = new InMemoryRoleRepository();
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
    roleRepository,
  });
  return { createUser, userRepositoryFactory, passwordHasher, unitOfWork, auditRecorder, roleRepository };
}

describe('createCreateUserUseCase', () => {
  it('creates and persists a new ACTIVE user scoped to the caller\'s organization', async () => {
    const { createUser, userRepositoryFactory, passwordHasher } = buildUseCase();

    const user = await createUser({
      auth: ORG_1_ADMIN,
      email: 'alice@example.com',
      password: 'Sup3rSecret',
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: 'ANALYST',
    });

    expect(user.status).toBe('ACTIVE');
    expect(user.email).toBe('alice@example.com');
    expect(user.credential.passwordHash).toBe('hashed:Sup3rSecret');
    expect(passwordHasher.hashCallCount).toBe(1);
    const persisted = await userRepositoryFactory.forTenant(user.organizationId).findById(user.id);
    expect(persisted?.firstName).toBe('Alice');
  });

  it('rejects a duplicate email within the same organization with USER_EMAIL_TAKEN', async () => {
    const { createUser } = buildUseCase();
    await createUser({ auth: ORG_1_ADMIN, email: 'alice@example.com', password: 'Passw0rd1', firstName: 'A', lastName: 'S', roleId: 'ANALYST' });

    expect.assertions(2);
    try {
      await createUser({ auth: ORG_1_ADMIN, email: 'alice@example.com', password: 'Passw0rd2', firstName: 'A2', lastName: 'S2', roleId: 'ANALYST' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_EMAIL_TAKEN');
    }
  });

  it('allows the same email to be used across two different organizations', async () => {
    const { createUser } = buildUseCase();
    await createUser({ auth: ORG_1_ADMIN, email: 'shared@example.com', password: 'Passw0rd1', firstName: 'A', lastName: 'S', roleId: 'ANALYST' });

    const secondOrgUser = await createUser({
      auth: ORG_2_ADMIN,
      email: 'shared@example.com',
      password: 'Passw0rd2',
      firstName: 'B',
      lastName: 'T',
      roleId: 'ANALYST',
    });

    expect(secondOrgUser.email).toBe('shared@example.com');
    expect(secondOrgUser.organizationId).toBe('org-2');
  });

  it('emits exactly one USER_CREATED audit event inside the transaction', async () => {
    const { createUser, auditRecorder } = buildUseCase();

    const user = await createUser({
      auth: ORG_1_ADMIN,
      email: 'alice@example.com',
      password: 'Sup3rSecret',
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: 'ANALYST',
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
    await createUser({ auth: ORG_1_ADMIN, email: 'dup@example.com', password: 'Passw0rd1', firstName: 'A', lastName: 'S', roleId: 'ANALYST' });
    auditRecorder.calls(); // first create recorded one event

    await expect(
      createUser({ auth: ORG_1_ADMIN, email: 'dup@example.com', password: 'Passw0rd2', firstName: 'A2', lastName: 'S2', roleId: 'ANALYST' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(auditRecorder.all().filter((e) => e.action === 'USER_CREATED')).toHaveLength(1);
  });

  it('persists the requested roleId on the created user', async () => {
    const { createUser } = buildUseCase();

    const user = await createUser({
      auth: ORG_1_ADMIN,
      email: 'alice@example.com',
      password: 'Passw0rd1',
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: 'SUPERVISOR',
    });

    expect(user.roleId).toBe('SUPERVISOR');
  });

  it('rejects a non-ADMIN USER-tier actor with FORBIDDEN_ROLE before any user is persisted', async () => {
    const { createUser, userRepositoryFactory } = buildUseCase();

    expect.assertions(3);
    try {
      await createUser({
        auth: ORG_1_USER,
        email: 'alice@example.com',
        password: 'Passw0rd1',
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: 'ANALYST',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_ROLE');
    }
    const list = await userRepositoryFactory.forTenant(createOrganizationId('org-1')).list(10);
    expect(list.items).toHaveLength(0);
  });

  it('rejects a weak password with WEAK_PASSWORD before hashing or persisting', async () => {
    const { createUser, passwordHasher, userRepositoryFactory } = buildUseCase();

    expect.assertions(3);
    try {
      await createUser({
        auth: ORG_1_ADMIN,
        email: 'alice@example.com',
        password: '123',
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: 'ANALYST',
      });
    } catch (error) {
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('WEAK_PASSWORD');
    }
    expect(passwordHasher.hashCallCount).toBe(0);
    const list = await userRepositoryFactory.forTenant(createOrganizationId('org-1')).list(10);
    expect(list.items).toHaveLength(0);
  });

  it('rejects roleId ADMIN with ROLE_NOT_ASSIGNABLE', async () => {
    const { createUser } = buildUseCase();

    expect.assertions(2);
    try {
      await createUser({
        auth: ORG_1_ADMIN,
        email: 'alice@example.com',
        password: 'Passw0rd1',
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: 'ADMIN',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });

  it('rejects an unknown roleId with INVARIANT_VIOLATION (RoleId VO closed-set gate)', async () => {
    const { createUser } = buildUseCase();

    expect.assertions(2);
    try {
      await createUser({
        auth: ORG_1_ADMIN,
        email: 'alice@example.com',
        password: 'Passw0rd1',
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: 'NOT-A-ROLE',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('rejects an inactive roleId with ROLE_NOT_ASSIGNABLE', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const passwordHasher = new FakePasswordHasher();
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const roleRepository = withRoles([buildRoleView('SUPERVISOR', { status: 'INACTIVE' })]);
    const createUser = createCreateUserUseCase({
      userRepositoryFactory,
      passwordHasher,
      unitOfWork,
      clock: new FixedClock(NOW),
      generateId: () => createUserId('user-inactive-role'),
      auditRecorder,
      roleRepository,
    });

    expect.assertions(2);
    try {
      await createUser({
        auth: ORG_1_ADMIN,
        email: 'alice@example.com',
        password: 'Passw0rd1',
        firstName: 'Alice',
        lastName: 'Smith',
        roleId: 'SUPERVISOR',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });
});
