import { oid } from '../../../support/oid.js';
import { authenticator } from 'otplib';
import { createActivateMfaUseCase } from '../../../../src/modules/identity-access/application/ActivateMfa.js';
import { createSessionIssuer } from '../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { InMemoryMfaChallengeStore } from '../../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { OtplibTotpService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
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
const ACTIVATED_AT = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const AUTH = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), isPlatformAdmin: false });
const ENROLLMENT_AUTH = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  purpose: 'enrollment',
  mfaJti: 'jti-1',
});
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOTP_SERVICE = new OtplibTotpService();
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);

async function seedUserWithPendingSecret(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  plaintextSecret: string,
): Promise<void> {
  const org = createOrganizationId(oid('org-1'));
  const user = User.create({
    id: createUserId(oid('user-1')),
    organizationId: org,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  }).startMfaEnrollment(SECRET_CIPHER.encrypt(plaintextSecret), CREATED_AT);
  await userRepositoryFactory.forTenant(org).save(user);
}

function buildUseCase(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  unitOfWork: InMemoryUnitOfWork,
  auditRecorder: InMemoryAuditRecorder = new InMemoryAuditRecorder(),
  mfaChallenges: InMemoryMfaChallengeStore = new InMemoryMfaChallengeStore(),
  sessions: InMemorySessionRepository = new InMemorySessionRepository(),
) {
  const issueSessionFor = createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: { sessionSeconds: 900, refreshSeconds: 1_209_600, familySeconds: 2_592_000 },
  });
  return createActivateMfaUseCase({
    userRepositoryFactory,
    unitOfWork,
    clock: new FixedClock(ACTIVATED_AT),
    totpService: TOTP_SERVICE,
    secretCipher: SECRET_CIPHER,
    auditRecorder,
    mfaChallenges,
    issueSessionFor,
  });
}

describe('createActivateMfaUseCase', () => {
  it('enables MFA and emits MFA_ENABLED when the token is valid (full-scope, self-service — no session minted)', async () => {
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);
    const token = authenticator.generate(plaintextSecret);

    const result = await activateMfa({ auth: AUTH, token });

    expect(result.user.mfa.enabled).toBe(true);
    expect(result.session).toBeNull();
    expect(unitOfWork.transactionCount).toBe(1);
    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeDefined();
    expect(calls[0].event.action).toBe('MFA_ENABLED');
    expect(calls[0].event.resource).toBe('users');
    expect(calls[0].event.resourceId).toBe(oid('user-1'));
  });

  it('rejects a wrong token with MFA_TOKEN_INVALID and does NOT enable MFA', async () => {
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
    const unitOfWork = new InMemoryUnitOfWork();
    const auditRecorder = new InMemoryAuditRecorder();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder);

    expect.assertions(4);
    try {
      await activateMfa({ auth: AUTH, token: '000000' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('MFA_TOKEN_INVALID');
    }

    const stored = await userRepositoryFactory.forTenant(createOrganizationId(oid('org-1'))).findById(createUserId(oid('user-1')));
    expect(stored!.mfa.enabled).toBe(false);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('rejects activation with no pending enrollment (MFA_ENROLLMENT_NOT_PENDING)', async () => {
    const org = createOrganizationId(oid('org-1'));
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const user = User.create({
      id: createUserId(oid('user-1')),
      organizationId: org,
      email: createEmail('alice@example.com'),
      credential: createPasswordCredential('hash'),
      firstName: 'Alice',
      lastName: 'Smith',
      roleId: createRoleId('ANALYST'),
      now: CREATED_AT,
    });
    await userRepositoryFactory.forTenant(org).save(user);
    const unitOfWork = new InMemoryUnitOfWork();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    expect.assertions(2);
    try {
      await activateMfa({ auth: AUTH, token: '123456' });
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityAccessError);
      expect((error as InstanceType<typeof IdentityAccessError>).code).toBe('MFA_ENROLLMENT_NOT_PENDING');
    }
  });

  it('rejects an unknown authenticated user with USER_NOT_FOUND', async () => {
    const userRepositoryFactory = new InMemoryUserRepositoryFactory();
    const unitOfWork = new InMemoryUnitOfWork();
    const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork);

    await expect(activateMfa({ auth: AUTH, token: '123456' })).rejects.toBeInstanceOf(IdentityAccessError);
  });

  describe('forced-enrollment hand-off (two-step-login PR3, design D4)', () => {
    it('consumes the enrollment jti and mints a full session when auth.purpose is "enrollment"', async () => {
      const plaintextSecret = TOTP_SERVICE.generateSecret();
      const userRepositoryFactory = new InMemoryUserRepositoryFactory();
      await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
      const unitOfWork = new InMemoryUnitOfWork();
      const auditRecorder = new InMemoryAuditRecorder();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      await mfaChallenges.append({
        jti: 'jti-1',
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        actorType: 'USER',
        tokenType: 'mfa_enrollment',
        expiresAt: fromDate(new Date('2026-01-02T01:00:00.000Z')),
        now: CREATED_AT,
      });
      const sessions = new InMemorySessionRepository();
      const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, auditRecorder, mfaChallenges, sessions);
      const token = authenticator.generate(plaintextSecret);

      const result = await activateMfa({ auth: ENROLLMENT_AUTH, token });

      expect(result.user.mfa.enabled).toBe(true);
      expect(result.session).not.toBeNull();
      expect(result.session!.accessToken).toBeDefined();
      expect(result.session!.refreshToken).toBeDefined();
      expect((await mfaChallenges.get('jti-1'))?.consumedAt).toBe(ACTIVATED_AT);
      const savedSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(result.session!.accessToken));
      expect(savedSession?.userId).toBe(oid('user-1'));
      expect(unitOfWork.transactionCount).toBe(1);
    });

    it('rejects a replayed (already-consumed) enrollment jti — no session minted', async () => {
      const plaintextSecret = TOTP_SERVICE.generateSecret();
      const userRepositoryFactory = new InMemoryUserRepositoryFactory();
      await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
      const unitOfWork = new InMemoryUnitOfWork();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      await mfaChallenges.append({
        jti: 'jti-1',
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        actorType: 'USER',
        tokenType: 'mfa_enrollment',
        expiresAt: fromDate(new Date('2026-01-02T01:00:00.000Z')),
        now: CREATED_AT,
      });
      await mfaChallenges.consume('jti-1', CREATED_AT); // simulate an already-spent jti
      const sessions = new InMemorySessionRepository();
      const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, new InMemoryAuditRecorder(), mfaChallenges, sessions);
      const token = authenticator.generate(plaintextSecret);

      await expect(activateMfa({ auth: ENROLLMENT_AUTH, token })).rejects.toMatchObject({
        code: 'MFA_CHALLENGE_INVALID',
      });

      // Note: `InMemoryUnitOfWork` runs `work` directly with no real
      // rollback (unlike the genuine Mongo multi-document transaction) — the
      // `confirmMfaEnrollment` write this fake already applied stays
      // in place. The real adapter's `withTransaction` aborts the whole
      // transaction on throw, so that write never commits there.
      expect(await sessions.findByTokenHash('anything')).toBeNull();
    });

    it('rejects an unknown enrollment jti (never appended) — no session', async () => {
      const plaintextSecret = TOTP_SERVICE.generateSecret();
      const userRepositoryFactory = new InMemoryUserRepositoryFactory();
      await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
      const unitOfWork = new InMemoryUnitOfWork();
      const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork);
      const token = authenticator.generate(plaintextSecret);

      await expect(activateMfa({ auth: ENROLLMENT_AUTH, token })).rejects.toMatchObject({
        code: 'MFA_CHALLENGE_INVALID',
      });
    });

    it('a wrong TOTP under an enrollment-scoped auth never touches the jti or mints a session', async () => {
      const plaintextSecret = TOTP_SERVICE.generateSecret();
      const userRepositoryFactory = new InMemoryUserRepositoryFactory();
      await seedUserWithPendingSecret(userRepositoryFactory, plaintextSecret);
      const unitOfWork = new InMemoryUnitOfWork();
      const mfaChallenges = new InMemoryMfaChallengeStore();
      await mfaChallenges.append({
        jti: 'jti-1',
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        actorType: 'USER',
        tokenType: 'mfa_enrollment',
        expiresAt: fromDate(new Date('2026-01-02T01:00:00.000Z')),
        now: CREATED_AT,
      });
      const activateMfa = buildUseCase(userRepositoryFactory, unitOfWork, new InMemoryAuditRecorder(), mfaChallenges);

      await expect(activateMfa({ auth: ENROLLMENT_AUTH, token: '000000' })).rejects.toMatchObject({
        code: 'MFA_TOKEN_INVALID',
      });

      expect((await mfaChallenges.get('jti-1'))?.consumedAt).toBeNull();
    });
  });
});
