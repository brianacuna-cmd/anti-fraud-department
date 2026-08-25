import { oid } from '../../../support/oid.js';
import { createTransitionUserStatusUseCase } from '../../../../src/modules/identity-access/application/TransitionUserStatus.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
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
import { buildSession } from '../../../helpers/identity-access/buildSession.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const TRANSITIONED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_ADMIN = createAuthContext({ userId: oid('u1'), organizationId: oid('org-1'), actorType: 'ORGANIZATION' });
const OTHER_ORG_ADMIN = createAuthContext({ userId: oid('u2'), organizationId: oid('org-2'), actorType: 'ORGANIZATION' });
const PLATFORM_ADMIN = createAuthContext({ userId: oid('u3'), organizationId: oid('org-1'), isPlatformAdmin: true });

async function seedUser(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  organizationId = oid('org-1'),
): Promise<void> {
  const org = createOrganizationId(organizationId);
  let user = User.create({
    id: createUserId(oid('user-1')),
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
  sessions: InMemorySessionRepository = new InMemorySessionRepository(),
) {
  return createTransitionUserStatusUseCase({
    userRepositoryFactory,
    sessions,
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

    const user = await transitionUserStatus({ auth: ORG_ADMIN, userId: oid('user-1'), next: 'SUSPENDED' });

    expect(user.status).toBe('SUSPENDED');
    expect(unitOfWork.transactionCount).toBe(1);
  });

  it('rejects an unknown id with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: ORG_ADMIN, userId: oid('missing'), next: 'SUSPENDED' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('USER_NOT_FOUND');
    }
  });

  it('rejects a cross-tenant transition with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory, 'ACTIVE', oid('org-1'));
    const unitOfWork = new InMemoryUnitOfWork();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await transitionUserStatus({ auth: OTHER_ORG_ADMIN, userId: oid('user-1'), next: 'SUSPENDED' });
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
      await transitionUserStatus({ auth: ORG_ADMIN, userId: oid('user-1'), next: 'ACTIVE' });
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

    const user = await transitionUserStatus({ auth: PLATFORM_ADMIN, userId: oid('user-1'), next: 'ACTIVE' });

    expect(user.status).toBe('ACTIVE');
  });

  it('emits exactly one USER_STATUS_CHANGED audit event inside the transaction', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    await transitionUserStatus({ auth: ORG_ADMIN, userId: oid('user-1'), next: 'SUSPENDED' });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('USER_STATUS_CHANGED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe(oid('user-1'));
    expect(calls[0].event.detail).toEqual({ from: 'ACTIVE', to: 'SUSPENDED' });
  });

  it('records no audit event when the transition fails (unknown id)', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    await expect(
      transitionUserStatus({ auth: ORG_ADMIN, userId: oid('missing'), next: 'SUSPENDED' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('on DISABLED, revokes all sessions for the user and emits USER_SESSIONS_REVOKED + USER_STATUS_CHANGED', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const sessions = new InMemorySessionRepository();
    await sessions.save(buildSession({ id: oid('session-1'), now: CREATED_AT, expiresAt: TRANSITIONED_AT }));
    await sessions.save(buildSession({ id: oid('session-2'), now: CREATED_AT, expiresAt: TRANSITIONED_AT }));
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder, sessions);

    await transitionUserStatus({ auth: ORG_ADMIN, userId: oid('user-1'), next: 'DISABLED' });

    const revokedSession1 = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    const revokedSession2 = await sessions.findByTokenHash(`token-hash-${oid('session-2')}`);
    expect(revokedSession1?.deletedAt).toBe(TRANSITIONED_AT);
    expect(revokedSession2?.deletedAt).toBe(TRANSITIONED_AT);

    expect(auditRecorder.all()).toHaveLength(2);
    const [sessionsRevoked, statusChanged] = auditRecorder.all();
    expect(sessionsRevoked).toMatchObject({
      action: 'USER_SESSIONS_REVOKED',
      resource: 'sessions',
      resourceId: null,
      detail: { revokedCount: 2 },
    });
    expect(statusChanged).toMatchObject({
      action: 'USER_STATUS_CHANGED',
      resource: 'users',
      detail: { from: 'ACTIVE', to: 'DISABLED' },
    });
  });

  it('does not revoke sessions or emit USER_SESSIONS_REVOKED for a SUSPENDED transition', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUser(userRepositoryFactory);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const sessions = new InMemorySessionRepository();
    await sessions.save(buildSession({ id: oid('session-1'), now: CREATED_AT, expiresAt: TRANSITIONED_AT }));
    const transitionUserStatus = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder, sessions);

    await transitionUserStatus({ auth: ORG_ADMIN, userId: oid('user-1'), next: 'SUSPENDED' });

    const untouched = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    expect(untouched?.deletedAt).toBeNull();
    expect(auditRecorder.all().some((event) => event.action === 'USER_SESSIONS_REVOKED')).toBe(false);
  });
});
