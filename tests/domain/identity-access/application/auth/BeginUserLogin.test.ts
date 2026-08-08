import { createBeginUserLoginUseCase } from '../../../../../src/modules/identity-access/application/auth/BeginUserLogin.js';
import { createAuthenticateActorUseCase } from '../../../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { InMemoryActorCredentialGateway } from '../../../../helpers/identity-access/InMemoryActorCredentialGateway.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { InMemoryMfaChallengeStore } from '../../../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { FakePasswordHasher } from '../../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { createPasswordCredential } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import type { ActorCredentialRecord } from '../../../../../src/modules/identity-access/domain/ports/ActorCredentialGateway.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DUMMY_CREDENTIAL = createPasswordCredential('hashed:dummy-password');
const ORG_ID = createOrganizationId('org-1');
const TOKEN_SERVICE = new AesGcmSessionTokenService(new AesGcmSecretCipher('test-secret', 1));

const MFA_ENABLED_RECORD: ActorCredentialRecord = {
  actorId: 'user-1',
  actorType: 'USER',
  organizationId: ORG_ID,
  credential: createPasswordCredential('hashed:correct-password'),
  lockout: { loginAttempts: 0, blockedUntil: null },
  status: 'ACTIVE',
  mfa: { enabled: true, secret: 'encrypted-secret' },
};

const MFA_DISABLED_RECORD: ActorCredentialRecord = {
  ...MFA_ENABLED_RECORD,
  mfa: { enabled: false, secret: null },
};

function buildUseCase(challengeTtlSeconds = 300, enrollmentTtlSeconds = 900) {
  const gateway = new InMemoryActorCredentialGateway();
  const mfaChallenges = new InMemoryMfaChallengeStore();
  const authenticateActor = createAuthenticateActorUseCase({
    gateway,
    passwordHasher: new FakePasswordHasher(),
    clock: new FixedClock(NOW),
    dummyCredential: DUMMY_CREDENTIAL,
    actorType: 'USER',
    auditRecorder: new InMemoryAuditRecorder(),
  });
  const beginUserLogin = createBeginUserLoginUseCase({
    authenticateActor,
    sessionTokenService: TOKEN_SERVICE,
    mfaChallenges,
    clock: new FixedClock(NOW),
    tokenKeyVersion: 1,
    challengeTtlSeconds,
    enrollmentTtlSeconds,
  });
  return { beginUserLogin, gateway, mfaChallenges };
}

describe('createBeginUserLoginUseCase', () => {
  it('mints an mfa_challenge token and appends it when mfa.enabled=true', async () => {
    const { beginUserLogin, gateway, mfaChallenges } = buildUseCase();
    gateway.seed('alice@example.com', MFA_ENABLED_RECORD, 'acme');

    const result = await beginUserLogin({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' });

    expect(result.kind).toBe('challenge');
    const payload = TOKEN_SERVICE.read(result.token);
    expect(payload).toMatchObject({
      tokenType: 'mfa_challenge',
      userId: 'user-1',
      organizationId: 'org-1',
      actorType: 'USER',
    });
    expect(payload && 'jti' in payload ? mfaChallenges.get(payload.jti) : undefined).toBeDefined();
  });

  it('mints an mfa_enrollment token and appends it when mfa.enabled=false', async () => {
    const { beginUserLogin, gateway, mfaChallenges } = buildUseCase();
    gateway.seed('alice@example.com', MFA_DISABLED_RECORD, 'acme');

    const result = await beginUserLogin({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' });

    expect(result.kind).toBe('enrollment');
    const payload = TOKEN_SERVICE.read(result.token);
    expect(payload).toMatchObject({ tokenType: 'mfa_enrollment', userId: 'user-1' });
    expect(payload && 'jti' in payload ? mfaChallenges.get(payload.jti) : undefined).toBeDefined();
  });

  it('sets expiresAt using the challenge TTL for the enabled branch', async () => {
    const { beginUserLogin, gateway } = buildUseCase(300, 900);
    gateway.seed('alice@example.com', MFA_ENABLED_RECORD, 'acme');

    const result = await beginUserLogin({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' });

    const payload = TOKEN_SERVICE.read(result.token);
    expect(payload && 'expiresAt' in payload ? payload.expiresAt : null).toBe('2026-01-01T00:05:00.000Z');
  });

  it('sets expiresAt using the enrollment TTL for the disabled branch', async () => {
    const { beginUserLogin, gateway } = buildUseCase(300, 900);
    gateway.seed('alice@example.com', MFA_DISABLED_RECORD, 'acme');

    const result = await beginUserLogin({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' });

    const payload = TOKEN_SERVICE.read(result.token);
    expect(payload && 'expiresAt' in payload ? payload.expiresAt : null).toBe('2026-01-01T00:15:00.000Z');
  });

  it('propagates AuthenticateActor rejections (INVALID_CREDENTIALS) without minting anything', async () => {
    const { beginUserLogin, mfaChallenges } = buildUseCase();

    await expect(
      beginUserLogin({ email: 'nobody@example.com', password: 'whatever', organizationSlug: 'acme' }),
    ).rejects.toBeInstanceOf(IdentityAccessError);
    expect(mfaChallenges.get('any')).toBeUndefined();
  });
});
