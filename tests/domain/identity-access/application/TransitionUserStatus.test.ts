import { createTransitionUserStatusUseCase } from '../../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
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
  status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  organizationId = 'org-1',
): Promise<void> {
  const org = createOrganizationId(organizationId);
  let user = User.create({
    id: createUserId('user-1'),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  });
  if (status === 'DISABLED') {
    user = user.transitionTo('DISABLED', { isPlatformAdmin: true }, CREATED_AT);
  }
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  unitOfWork: InMemoryUnitOfWork,
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
) {
  return createTransitionUserStatusUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(TRANSITIONED_AT),
    auditRecorder,
  });
}

describe('createTransitionUserStatusUseCase', () => {
  it('runs the transition inside a unit-of-work transaction and persists the result', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    const user = await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'SUSPENDED' });

    expect(user.status).toBe('SUSPENDED');
    expect(unitOfWork.transactionCount).toBe(1);
  });

  it('rejects an unknown id with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: ORG_ADMIN, userId: 'missing', next: 'SUSPENDED' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects a cross-tenant transition with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'ACTIVE', 'org-1');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: OTHER_ORG_ADMIN, userId: 'user-1', next: 'SUSPENDED' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects an org-admin self-reactivating a DISABLED user in their own org with FORBIDDEN_REACTIVATION', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'DISABLED');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'ACTIVE' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('FORBIDDEN_REACTIVATION');
    }
  });

  it('allows a platform-admin to reactivate a DISABLED user', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'DISABLED');
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    const user = await transitionUserStatus({ auth: PLATFORM_ADMIN, userId: 'user-1', next: 'ACTIVE' });

    expect(user.status).toBe('ACTIVE');
  });

  it('emits exactly one USER_STATUS_CHANGED audit event inside the transaction', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    await transitionUserStatus({ auth: ORG_ADMIN, userId: 'user-1', next: 'SUSPENDED' });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('USER_STATUS_CHANGED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe('user-1');
    expect(calls[0].event.detail).toEqual({ from: 'ACTIVE', to: 'SUSPENDED' });
  });

  it('records no audit event when the transition fails (unknown id)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    await expect(
      transitionUserStatus({ auth: ORG_ADMIN, userId: 'missing', next: 'SUSPENDED' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(auditRecorder.all()).toHaveLength(0);
  });
});
