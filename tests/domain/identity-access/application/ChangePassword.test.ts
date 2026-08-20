import { oid } from '../../../support/oid.js';
import { createChangePasswordUseCase } from '../../../../src/modules/identity-access/application/ChangePassword.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { FakePasswordHasher } from '../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { buildSession } from '../../../helpers/identity-access/buildSession.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CHANGED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const AUTH = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), isPlatformAdmin: false });
const CURRENT_PASSWORD = 'current-password';
const NEW_PASSWORD = 'BrandNewPassw0rd';

async function seedUser(userRepositoryFactory: InMemoryUserRepositoryFactory, passwordHasher: FakePasswordHasher): Promise<void> {
  const org = createOrganizationId(oid('org-1'));
  const credential = await passwordHasher.hash(CURRENT_PASSWORD);
  const user = User.create({
    id: createUserId(oid('user-1')),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential,
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  });
  await userRepositoryFactory.forTenant(org).save(user);
}

async function seedSession(sessions: InMemorySessionRepository): Promise<void> {
  const farFuture = fromDate(new Date('2099-01-01T00:00:00.000Z'));
  await sessions.save(
    buildSession({
      id: oid('session-1'),
      tokenHash: 'token-hash-1',
      expiresAt: farFuture,
      now: CREATED_AT,
    }),
  );
}

function buildUseCase(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  unitOfWork: InMemoryUnitOfWork,
  sessions: InMemorySessionRepository,
  auditRecorder: InMemoryAuditRecorder,
  passwordHasher: FakePasswordHasher,
) {
  return createChangePasswordUseCase({
    userRepositoryFactory,
    passwordHasher,
    sessions,
    unitOfWork,
    clock: new FixedClock(CHANGED_AT),
    auditRecorder,
  });
}

describe('createChangePasswordUseCase', () => {
  it('replaces the credential, revokes all sessions, and emits exactly one PASSWORD_CHANGED audit event on correct current password', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const passwordHasher = new FakePasswordHasher();
    await seedUser(userRepositoryFactory, passwordHasher);
    const sessions = new InMemorySessionRepository();
    await seedSession(sessions);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const changePassword = buildUseCase(userRepositoryFactory, unitOfWork, sessions, auditRecorder, passwordHasher);

    const user = await changePassword({ auth: AUTH, currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD });

    expect(user.credential).toEqual(await passwordHasher.hash(NEW_PASSWORD));
    expect(unitOfWork.transactionCount).toBe(1);

    const revokedSession = await sessions.findByTokenHash('token-hash-1');
    expect(revokedSession?.deletedAt).not.toBeNull();

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('PASSWORD_CHANGED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe(oid('user-1'));
  });

  it('rejects a weak new password with WEAK_PASSWORD without hashing, mutating, or recording anything', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const passwordHasher = new FakePasswordHasher();
    await seedUser(userRepositoryFactory, passwordHasher);
    const sessions = new InMemorySessionRepository();
    await seedSession(sessions);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const changePassword = buildUseCase(userRepositoryFactory, unitOfWork, sessions, auditRecorder, passwordHasher);

    await expect(
      changePassword({ auth: AUTH, currentPassword: CURRENT_PASSWORD, newPassword: '123' }),
    ).rejects.toMatchObject({ code: 'WEAK_PASSWORD' });

    expect(unitOfWork.transactionCount).toBe(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('rejects a wrong current password without mutating the credential, revoking sessions, or recording an audit event', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const passwordHasher = new FakePasswordHasher();
    await seedUser(userRepositoryFactory, passwordHasher);
    const sessions = new InMemorySessionRepository();
    await seedSession(sessions);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const changePassword = buildUseCase(userRepositoryFactory, unitOfWork, sessions, auditRecorder, passwordHasher);

    await expect(
      changePassword({ auth: AUTH, currentPassword: 'wrong-password', newPassword: NEW_PASSWORD }),
    ).rejects.toBeInstanceOf(IdentityAccessError);

    const stored = await userRepositoryFactory.forTenant(createOrganizationId(oid('org-1'))).findById(createUserId(oid('user-1')));
    expect(stored?.credential).toEqual(await passwordHasher.hash(CURRENT_PASSWORD));

    const stillLiveSession = await sessions.findByTokenHash('token-hash-1');
    expect(stillLiveSession?.deletedAt).toBeNull();

    expect(auditRecorder.calls()).toHaveLength(0);
  });
});
