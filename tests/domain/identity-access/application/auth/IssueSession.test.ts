import { oid } from '../../../../support/oid.js';
import { authenticator } from 'otplib';
import { createIssueSessionUseCase } from '../../../../../src/modules/identity-access/application/auth/IssueSession.js';
import { createSessionIssuer } from '../../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { InMemoryUserRepositoryFactory } from '../../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { InMemoryMfaChallengeStore } from '../../../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { OtplibTotpService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';
import { User } from '../../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../../../../../src/modules/identity-access/domain/model/value-objects/RoleId.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import type { MfaChallengeRecord } from '../../../../../src/modules/identity-access/domain/ports/MfaChallengeStore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREATED_AT = fromDate(new Date('2025-12-31T00:00:00.000Z'));
const ORG_ID = createOrganizationId(oid('org-1'));
const SECRET_CIPHER = new AesGcmSecretCipher('test-secret', 1);
const TOTP_SERVICE = new OtplibTotpService();
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);

async function seedActivatedUser(
  userRepositoryFactory: InMemoryUserRepositoryFactory,
  plaintextSecret: string,
): Promise<void> {
  const user = User.create({
    id: createUserId(oid('user-1')),
    organizationId: ORG_ID,
    email: createEmail('alice@example.com'),
    credential: createPasswordCredential('hash'),
    firstName: 'Alice',
    lastName: 'Smith',
    roleId: createRoleId('ANALYST'),
    now: CREATED_AT,
  })
    .startMfaEnrollment(SECRET_CIPHER.encrypt(plaintextSecret), CREATED_AT)
    .confirmMfaEnrollment(CREATED_AT);
  await userRepositoryFactory.forTenant(ORG_ID).save(user);
}

function issueChallengeToken(jti: string, expiresAt = fromDate(new Date('2026-01-01T00:05:00.000Z'))): string {
  return TOKEN_SERVICE.issue({
    tokenType: 'mfa_challenge',
    keyVersion: 1,
    jti,
    userId: oid('user-1'),
    organizationId: oid('org-1'),
    actorType: 'USER',
    expiresAt,
  });
}

function buildHarness() {
  const userRepositoryFactory = new InMemoryUserRepositoryFactory();
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const mfaChallenges = new InMemoryMfaChallengeStore();
  const sessionIssuer = createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: { sessionSeconds: 900 },
  });
  const issueSession = createIssueSessionUseCase({
    sessionTokenService: TOKEN_SERVICE,
    mfaChallenges,
    userRepositoryFactory,
    totpService: TOTP_SERVICE,
    secretCipher: SECRET_CIPHER,
    unitOfWork,
    clock: new FixedClock(NOW),
    issueSessionFor: sessionIssuer,
    auditRecorder,
  });
  return { userRepositoryFactory, sessions, unitOfWork, auditRecorder, mfaChallenges, issueSession };
}

async function appendChallenge(mfaChallenges: InMemoryMfaChallengeStore, record: Partial<MfaChallengeRecord> & { jti: string }): Promise<void> {
  await mfaChallenges.append({
    userId: oid('user-1'),
    organizationId: oid('org-1'),
    actorType: 'USER',
    tokenType: 'mfa_challenge',
    expiresAt: fromDate(new Date('2026-01-01T00:05:00.000Z')),
    now: fromDate(new Date('2025-12-31T23:59:00.000Z')),
    ...record,
  });
}

describe('createIssueSessionUseCase', () => {
  it('happy path: consumes the jti, mints ACCESS+REFRESH, and audits LOGIN', async () => {
    const { userRepositoryFactory, mfaChallenges, sessions, unitOfWork, auditRecorder, issueSession } = buildHarness();
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    await seedActivatedUser(userRepositoryFactory, plaintextSecret);
    await appendChallenge(mfaChallenges, { jti: 'jti-1' });
    const challengeToken = issueChallengeToken('jti-1');
    const totp = authenticator.generate(plaintextSecret);

    const result = await issueSession({ challengeToken, totp });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(unitOfWork.transactionCount).toBe(1);
    expect((await mfaChallenges.get('jti-1'))?.consumedAt).toBe(NOW);
    const saved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(result.accessToken));
    expect(saved?.userId).toBe(oid('user-1'));
    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('LOGIN');
    expect(calls[0].tx).toBeDefined();
  });

  it('rejects wrong TOTP without consuming the jti or creating a session', async () => {
    const { userRepositoryFactory, mfaChallenges, sessions, issueSession } = buildHarness();
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    await seedActivatedUser(userRepositoryFactory, plaintextSecret);
    await appendChallenge(mfaChallenges, { jti: 'jti-2' });
    const challengeToken = issueChallengeToken('jti-2');

    await expect(issueSession({ challengeToken, totp: '000000' })).rejects.toBeInstanceOf(IdentityAccessError);

    expect((await mfaChallenges.get('jti-2'))?.consumedAt).toBeNull();
    expect(await sessions.findByTokenHash('anything')).toBeNull();
  });

  it('rejects an expired challenge token before ever consulting the store', async () => {
    const { userRepositoryFactory, mfaChallenges, issueSession } = buildHarness();
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    await seedActivatedUser(userRepositoryFactory, plaintextSecret);
    const expiredExpiry = fromDate(new Date('2025-12-31T23:59:00.000Z'));
    await appendChallenge(mfaChallenges, { jti: 'jti-3', expiresAt: expiredExpiry });
    const challengeToken = issueChallengeToken('jti-3', expiredExpiry);
    const totp = authenticator.generate(plaintextSecret);

    await expect(issueSession({ challengeToken, totp })).rejects.toMatchObject({ code: 'MFA_CHALLENGE_INVALID' });
  });

  it('rejects a replayed (already-consumed) challenge token — no second session', async () => {
    const { userRepositoryFactory, mfaChallenges, sessions, issueSession } = buildHarness();
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    await seedActivatedUser(userRepositoryFactory, plaintextSecret);
    await appendChallenge(mfaChallenges, { jti: 'jti-4' });
    const challengeToken = issueChallengeToken('jti-4');
    const totp = authenticator.generate(plaintextSecret);

    const first = await issueSession({ challengeToken, totp });
    expect(first.accessToken).toBeDefined();

    const secondTotp = authenticator.generate(plaintextSecret);
    await expect(issueSession({ challengeToken, totp: secondTotp })).rejects.toMatchObject({
      code: 'MFA_CHALLENGE_INVALID',
    });

    const sessionsCount = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(first.accessToken));
    expect(sessionsCount).not.toBeNull();
  });

  it('rejects an unknown jti (never appended)', async () => {
    const { userRepositoryFactory, issueSession } = buildHarness();
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    await seedActivatedUser(userRepositoryFactory, plaintextSecret);
    const challengeToken = issueChallengeToken('never-appended');
    const totp = authenticator.generate(plaintextSecret);

    await expect(issueSession({ challengeToken, totp })).rejects.toMatchObject({ code: 'MFA_CHALLENGE_INVALID' });
  });

  it('rejects a malformed/ACCESS-typed token', async () => {
    const { issueSession } = buildHarness();
    const accessToken = TOKEN_SERVICE.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });

    await expect(issueSession({ challengeToken: accessToken, totp: '123456' })).rejects.toMatchObject({
      code: 'MFA_CHALLENGE_INVALID',
    });
  });

  it('rejects an mfa_enrollment-typed token at the challenge endpoint', async () => {
    const { userRepositoryFactory, mfaChallenges, issueSession } = buildHarness();
    const plaintextSecret = TOTP_SERVICE.generateSecret();
    await seedActivatedUser(userRepositoryFactory, plaintextSecret);
    await appendChallenge(mfaChallenges, { jti: 'jti-5', tokenType: 'mfa_enrollment' });
    const enrollmentToken = TOKEN_SERVICE.issue({
      tokenType: 'mfa_enrollment',
      keyVersion: 1,
      jti: 'jti-5',
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      expiresAt: fromDate(new Date('2026-01-01T00:05:00.000Z')),
    });
    const totp = authenticator.generate(plaintextSecret);

    await expect(issueSession({ challengeToken: enrollmentToken, totp })).rejects.toMatchObject({
      code: 'MFA_CHALLENGE_INVALID',
    });
  });
});
