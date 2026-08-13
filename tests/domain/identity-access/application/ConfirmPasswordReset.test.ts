import { oid } from '../../../support/oid.js';
import { createConfirmPasswordResetUseCase } from '../../../../src/modules/identity-access/application/auth/ConfirmPasswordReset.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { FakePasswordHasher } from '../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { User } from '../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { buildSession } from '../../../helpers/identity-access/buildSession.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const CREATED_AT = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const NOW = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-1'));
const OTHER_ORG_ID = createOrganizationId(oid('org-2'));
const TOKEN_SERVICE = new AesGcmSessionTokenService(new AesGcmSecretCipher('test-secret', 1));
const NEW_PASSWORD = 'BrandNewPassw0rd';

function buildFixture() {
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const passwordHasher = new FakePasswordHasher();
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const clock = new FixedClock(NOW);

  const confirmPasswordReset = createConfirmPasswordResetUseCase({
    sessionTokenService: TOKEN_SERVICE,
    userRepositoryFactory,
    passwordHasher,
    sessions,
    unitOfWork,
    clock,
    auditRecorder,
  });

  return { userRepositoryFactory, passwordHasher, sessions, unitOfWork, auditRecorder, clock, confirmPasswordReset };
}

/** Seeds a user with a real, unexpired pending reset token and returns the token string. */
async function seedUserWithPendingReset(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  options?: { readonly jti?: string; readonly tokenExpiresAt?: Date; readonly resetTokenExpiresAt?: Date },
): Promise<string> {
  const jti = options?.jti ?? 'reset-jti-1';
  const tokenExpiresAt = options?.tokenExpiresAt ?? new Date('2026-01-02T00:15:00.000Z');
  const resetTokenExpiresAt = options?.resetTokenExpiresAt ?? tokenExpiresAt;

  const user = User.create({
    id: createUserId(oid('user-1')),
    organizationId: ORG_ID,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hashed:old-password'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  });

  const token = TOKEN_SERVICE.issue({
    tokenType: 'password_reset',
    keyVersion: 1,
    jti,
    userId: oid('user-1'),
    organizationId: oid('org-1'),
    actorType: 'USER',
    expiresAt: fromDate(tokenExpiresAt),
  });

  const withPending = user.beginPasswordReset(
    { hash: TOKEN_SERVICE.fingerprint(jti), expiresAt: fromDate(resetTokenExpiresAt) },
    CREATED_AT,
  );
  await userRepositoryFactory.forTenant(ORG_ID).save(withPending);

  return token;
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

describe('createConfirmPasswordResetUseCase', () => {
  it('replaces the credential, clears resetToken, revokes all sessions, and emits exactly one PASSWORD_RESET_COMPLETED audit event', async () => {
    const { userRepositoryFactory, passwordHasher, sessions, unitOfWork, auditRecorder, confirmPasswordReset } = buildFixture();
    const token = await seedUserWithPendingReset(userRepositoryFactory);
    await seedSession(sessions);

    await confirmPasswordReset({ token, newPassword: NEW_PASSWORD });

    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId(oid('user-1')));
    expect(stored?.credential).toEqual(await passwordHasher.hash(NEW_PASSWORD));
    expect(stored?.resetToken).toBeNull();
    expect(unitOfWork.transactionCount).toBe(1);

    const revokedSession = await sessions.findByTokenHash('token-hash-1');
    expect(revokedSession?.deletedAt).not.toBeNull();

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('PASSWORD_RESET_COMPLETED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe(oid('user-1'));
  });

  it('rejects a weak new password with WEAK_PASSWORD, only AFTER the token/user checks pass, without mutating state', async () => {
    const { userRepositoryFactory, unitOfWork, auditRecorder, confirmPasswordReset } = buildFixture();
    const token = await seedUserWithPendingReset(userRepositoryFactory);

    await expect(confirmPasswordReset({ token, newPassword: '123' })).rejects.toMatchObject({
      code: 'WEAK_PASSWORD',
    });

    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId(oid('user-1')));
    expect(stored?.resetToken).not.toBeNull();
    expect(stored?.credential.passwordHash).toBe('hashed:old-password');
    expect(unitOfWork.transactionCount).toBe(0);
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('rejects an expired token (payload self-expiry) with the opaque PASSWORD_RESET_INVALID, without mutating state', async () => {
    const { userRepositoryFactory, auditRecorder, confirmPasswordReset } = buildFixture();
    const token = await seedUserWithPendingReset(userRepositoryFactory, {
      tokenExpiresAt: new Date('2026-01-01T23:59:59.000Z'),
      resetTokenExpiresAt: new Date('2026-01-02T00:15:00.000Z'),
    });

    await expect(confirmPasswordReset({ token, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });

    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId(oid('user-1')));
    expect(stored?.resetToken).not.toBeNull();
    expect(stored?.credential.passwordHash).toBe('hashed:old-password');
    expect(auditRecorder.calls()).toHaveLength(0);
  });

  it('rejects a stored resetToken that has itself expired, even if the token claim has not (double-check, design §2)', async () => {
    const { userRepositoryFactory, confirmPasswordReset } = buildFixture();
    const token = await seedUserWithPendingReset(userRepositoryFactory, {
      tokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
      resetTokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(confirmPasswordReset({ token, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });

  it('rejects a replayed token: the second confirm attempt fails because resetToken was already cleared', async () => {
    const { userRepositoryFactory, confirmPasswordReset } = buildFixture();
    const token = await seedUserWithPendingReset(userRepositoryFactory);

    await confirmPasswordReset({ token, newPassword: NEW_PASSWORD });

    await expect(confirmPasswordReset({ token, newPassword: 'another-password' })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });

    const stored = await userRepositoryFactory.forTenant(ORG_ID).findById(createUserId(oid('user-1')));
    expect(stored?.credential).toEqual(await new FakePasswordHasher().hash(NEW_PASSWORD));
  });

  it('rejects a tampered/undecryptable token', async () => {
    const { userRepositoryFactory, confirmPasswordReset } = buildFixture();
    const token = await seedUserWithPendingReset(userRepositoryFactory);
    const tampered = `${token}tampered`;

    await expect(confirmPasswordReset({ token: tampered, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });

  it('rejects a wrong tokenType (an ACCESS token presented at confirm)', async () => {
    const { confirmPasswordReset } = buildFixture();
    const accessToken = TOKEN_SERVICE.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });

    await expect(confirmPasswordReset({ token: accessToken, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });

  it('rejects a wrong tokenType (an mfa_challenge token presented at confirm)', async () => {
    const { confirmPasswordReset } = buildFixture();
    const mfaToken = TOKEN_SERVICE.issue({
      tokenType: 'mfa_challenge',
      keyVersion: 1,
      jti: 'mfa-jti',
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(confirmPasswordReset({ token: mfaToken, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });

  it('rejects a token minted for a user that does not exist in the resolved tenant', async () => {
    const { confirmPasswordReset } = buildFixture();
    const ghostToken = TOKEN_SERVICE.issue({
      tokenType: 'password_reset',
      keyVersion: 1,
      jti: 'ghost-jti',
      userId: oid('no-such-user'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(confirmPasswordReset({ token: ghostToken, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });

  it('rejects a token whose jti no longer matches the user\'s current stored resetToken (superseded by a later request)', async () => {
    const { userRepositoryFactory, confirmPasswordReset } = buildFixture();
    const firstToken = await seedUserWithPendingReset(userRepositoryFactory, { jti: 'first-jti' });
    // A second reset request overwrites the pending reset (latest-wins, design §1).
    await seedUserWithPendingReset(userRepositoryFactory, { jti: 'second-jti' });

    await expect(confirmPasswordReset({ token: firstToken, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });

  it('rejects a syntactically valid token for a user with no pending reset at all', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const user = User.create({
      id: createUserId(oid('user-1')),
      organizationId: ORG_ID,
      email: createEmail('alice@example.com'),
      credential: createPasswordCredential('hashed:old-password'),
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: createRoleId('ANALYST'),
      now: CREATED_AT,
    });
    await userRepositoryFactory.forTenant(ORG_ID).save(user);

    const confirmPasswordReset = createConfirmPasswordResetUseCase({
      sessionTokenService: TOKEN_SERVICE,
      userRepositoryFactory,
      passwordHasher: new FakePasswordHasher(),
      sessions: new InMemorySessionRepository(),
      unitOfWork: new InMemoryUnitOfWork(),
      clock: new FixedClock(NOW),
      auditRecorder: new InMemoryAuditRecorder(),
    });

    const neverIssuedToken = TOKEN_SERVICE.issue({
      tokenType: 'password_reset',
      keyVersion: 1,
      jti: 'never-stored-jti',
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(confirmPasswordReset({ token: neverIssuedToken, newPassword: NEW_PASSWORD })).rejects.toBeInstanceOf(
      IdentityAccessError,
    );
  });

  it('resolves the tenant strictly from the token, ignoring any other organization the userId happens to also exist in', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const jti = 'cross-tenant-jti';

    const userInOtherOrg = User.create({
      id: createUserId(oid('user-1')),
      organizationId: OTHER_ORG_ID,
      email: createEmail('alice@other.example.com'),
      credential: createPasswordCredential('hashed:old-password'),
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: createRoleId('ANALYST'),
      now: CREATED_AT,
    }).beginPasswordReset({ hash: TOKEN_SERVICE.fingerprint(jti), expiresAt: fromDate(new Date('2099-01-01T00:00:00.000Z')) }, CREATED_AT);
    await userRepositoryFactory.forTenant(OTHER_ORG_ID).save(userInOtherOrg);

    const confirmPasswordReset = createConfirmPasswordResetUseCase({
      sessionTokenService: TOKEN_SERVICE,
      userRepositoryFactory,
      passwordHasher: new FakePasswordHasher(),
      sessions: new InMemorySessionRepository(),
      unitOfWork: new InMemoryUnitOfWork(),
      clock: new FixedClock(NOW),
      auditRecorder: new InMemoryAuditRecorder(),
    });

    // Token claims org-1, but the matching resetToken hash only exists on the
    // user seeded under OTHER_ORG_ID — org-1 has no such user at all.
    const token = TOKEN_SERVICE.issue({
      tokenType: 'password_reset',
      keyVersion: 1,
      jti,
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await expect(confirmPasswordReset({ token, newPassword: NEW_PASSWORD })).rejects.toMatchObject({
      code: 'PASSWORD_RESET_INVALID',
    });
  });
});
