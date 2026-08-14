import { createChangeUserRoleUseCase } from '../../../../src/modules/identity-access/application/ChangeUserRole.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { InMemoryRoleRepository, withRoles, buildRoleView } from '../../../helpers/identity-access/InMemoryRoleRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CHANGED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1_ADMIN = createAuthContext({ userId: 'u1', organizationId: 'org-1', actorType: 'ORGANIZATION' });
const ORG_2_ADMIN = createAuthContext({ userId: 'u2', organizationId: 'org-2', actorType: 'ORGANIZATION' });
const ORG_1_USER = createAuthContext({ userId: 'u3', organizationId: 'org-1', isPlatformAdmin: false });

async function seedUser(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  organizationId = 'org-1',
  roleId = 'ANALYST',
): Promise<void> {
  const org = createOrganizationId(organizationId);
  const user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId(roleId),
    now: CREATED_AT,
  });
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  unitOfWork: InMemoryUnitOfWork,
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
  roleRepository: InMemoryRoleRepository = new InMemoryRoleRepository(),
) {
  return createChangeUserRoleUseCase({
    userRepositoryFactory,
    roleRepository,
    unitOfWork,
    clock: new FixedClock(CHANGED_AT),
    auditRecorder,
  });
}

describe('createChangeUserRoleUseCase', () => {
  it('changes the roleId inside a unit-of-work transaction and persists the result', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork);

    const user = await changeUserRole({ auth: ORG_1_ADMIN, userId: 'user-1', roleId: 'SUPERVISOR' });

    expect(user.roleId).toBe('SUPERVISOR');
    expect(user.updatedAt).toBe(CHANGED_AT);
    expect(unitOfWork.transactionCount).toBe(1);
    const persisted = await userRepositoryFactory.forTenant(createOrganizationId('org-1')).findById(user.id);
    expect(persisted?.roleId).toBe('SUPERVISOR');
  });

  it('rejects a non-ADMIN USER-tier actor with FORBIDDEN_ROLE', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await changeUserRole({ auth: ORG_1_USER, userId: 'user-1', roleId: 'SUPERVISOR' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('rejects roleId ADMIN with ROLE_NOT_ASSIGNABLE', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await changeUserRole({ auth: ORG_1_ADMIN, userId: 'user-1', roleId: 'ADMIN' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });

  it('rejects an unknown roleId with INVARIANT_VIOLATION (RoleId VO closed-set gate)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await changeUserRole({ auth: ORG_1_ADMIN, userId: 'user-1', roleId: 'NOT-A-ROLE' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('INVARIANT_VIOLATION');
    }
  });

  it('rejects an inactive roleId with ROLE_NOT_ASSIGNABLE', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const roleRepository = withRoles([
      buildRoleView('SUPERVISOR', { status: 'INACTIVE' }),
    ]);
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork, new InMemoryAuditRecorder(), roleRepository);

    expect.assertions(2);
    try {
      await changeUserRole({ auth: ORG_1_ADMIN, userId: 'user-1', roleId: 'SUPERVISOR' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });

  it('rejects an unknown target user with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await changeUserRole({ auth: ORG_1_ADMIN, userId: 'missing', roleId: 'SUPERVISOR' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects a cross-tenant target user with USER_NOT_FOUND (no existence leak)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'org-1');
    const unitOfWork = new InMemoryUnitOfWork();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await changeUserRole({ auth: ORG_2_ADMIN, userId: 'user-1', roleId: 'SUPERVISOR' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('emits exactly one USER_ROLE_CHANGED audit event inside the transaction', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    await changeUserRole({ auth: ORG_1_ADMIN, userId: 'user-1', roleId: 'SUPERVISOR' });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('USER_ROLE_CHANGED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe('user-1');
    expect(calls[0].event.detail).toEqual({ from: 'ANALYST', to: 'SUPERVISOR' });
  });

  it('records no audit event when the change fails (unknown user)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const changeUserRole = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    await expect(
      changeUserRole({ auth: ORG_1_ADMIN, userId: 'missing', roleId: 'SUPERVISOR' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(auditRecorder.all()).toHaveLength(0);
  });
});
