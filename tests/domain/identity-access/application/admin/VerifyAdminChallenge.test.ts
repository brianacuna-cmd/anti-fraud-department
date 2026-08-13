import { oid } from '../../../../support/oid.js';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createVerifyAdminChallengeUseCase } from '../../../../../src/modules/identity-access/application/admin/VerifyAdminChallenge.js';
import { createSessionIssuer } from '../../../../../src/modules/identity-access/application/auth/SessionIssuer.js';
import { NodeAdminSignatureVerifier } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminSignatureVerifier.js';
import { AesGcmSessionTokenService } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AdminOrganization } from '../../../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { InMemoryAdminOrganizationRepository } from '../../../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemoryAdminChallengeStore } from '../../../../helpers/identity-access/InMemoryAdminChallengeStore.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREATED_AT = fromDate(new Date('2025-12-31T00:00:00.000Z'));
const SECRET_CIPHER = new AesGcmSecretCipher('verify-admin-challenge-test-secret', 1);
const TOKEN_SERVICE = new AesGcmSessionTokenService(SECRET_CIPHER);
const CANONICAL_PREFIX = 'AFD-ADMIN-CHALLENGE-V1\n';

function generateEd25519KeyPair(): { publicKeySpkiPem: string; privateKeyPkcs8Pem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeySpkiPem: publicKey as unknown as string, privateKeyPkcs8Pem: privateKey as unknown as string };
}

function signChallenge(challenge: string, privateKeyPkcs8Pem: string): string {
  const message = Buffer.from(CANONICAL_PREFIX + challenge, 'utf8');
  return sign(null, message, privateKeyPkcs8Pem).toString('base64');
}

function buildHarness() {
  const admins = new InMemoryAdminOrganizationRepository();
  const adminChallenges = new InMemoryAdminChallengeStore();
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const sessionIssuer = createSessionIssuer({
    sessionTokenService: TOKEN_SERVICE,
    sessions,
    tokenKeyVersion: 1,
    ttls: { sessionSeconds: 900, refreshSeconds: 1_209_600, familySeconds: 2_592_000 },
  });
  const verifyAdminChallenge = createVerifyAdminChallengeUseCase({
    admins,
    adminChallenges,
    signatureVerifier: new NodeAdminSignatureVerifier(),
    unitOfWork,
    clock: new FixedClock(NOW),
    issueSessionFor: sessionIssuer,
    auditRecorder,
  });
  return { admins, adminChallenges, sessions, unitOfWork, auditRecorder, verifyAdminChallenge };
}

async function seedAdminWithActiveKey(
  admins: InMemoryAdminOrganizationRepository,
  keyPair: { publicKeySpkiPem: string },
  id = oid('admin-1'),
) {
  const admin = AdminOrganization.create({
    id: createAdminOrganizationId(id),
    email: createEmail('root@platform.internal'),
    keys: [
      createAdminKey({
        keyId: createAdminKeyId(oid('key-1')),
        publicKey: keyPair.publicKeySpkiPem,
        status: 'ACTIVE',
        encryptedPrivateKey: 'ciphertext',
        createdAt: CREATED_AT,
      }),
    ],
    now: CREATED_AT,
  });
  await admins.save(admin);
  return admin;
}

async function appendChallenge(
  adminChallenges: InMemoryAdminChallengeStore,
  overrides: { challengeId: string; adminOrganizationId: string; challenge: string; expiresAt?: ReturnType<typeof fromDate> },
) {
  await adminChallenges.append({
    challengeId: overrides.challengeId,
    adminOrganizationId: overrides.adminOrganizationId,
    challenge: overrides.challenge,
    expiresAt: overrides.expiresAt ?? fromDate(new Date('2026-01-02T00:00:00.000Z')),
    now: fromDate(new Date('2025-12-31T23:59:00.000Z')),
  });
}

describe('createVerifyAdminChallengeUseCase', () => {
  it('happy path: valid signature consumes the challenge and mints a PLATFORM_ADMIN, refresh-less session', async () => {
    const { admins, adminChallenges, sessions, unitOfWork, auditRecorder, verifyAdminChallenge } = buildHarness();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-1',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
    });
    const signature = signChallenge('raw-challenge-secret', keyPair.privateKeyPkcs8Pem);

    const result = await verifyAdminChallenge({ challengeId: 'challenge-id-1', signatureBase64: signature });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeNull();
    expect(unitOfWork.transactionCount).toBe(1);

    const entry = await adminChallenges.findById('challenge-id-1');
    expect(entry?.consumedAt).toBe(NOW);

    const saved = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(result.accessToken));
    expect(saved?.actorType).toBe('PLATFORM_ADMIN');
    expect(saved?.organizationId).toBeNull();
    expect(saved?.userId).toBe(admin.id);
    expect(saved?.refreshTokenHash).toBeNull();

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('PLATFORM_ADMIN_LOGIN');
    expect(calls[0].tx).toBeDefined();
  });

  it('rejects a forged signature (401-mapped error) WITHOUT consuming the challenge — retry-safe', async () => {
    const { admins, adminChallenges, sessions, auditRecorder, verifyAdminChallenge } = buildHarness();
    const keyPair = generateEd25519KeyPair();
    const forgerKeyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-2',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
    });
    const forgedSignature = signChallenge('raw-challenge-secret', forgerKeyPair.privateKeyPkcs8Pem);

    await expect(
      verifyAdminChallenge({ challengeId: 'challenge-id-2', signatureBase64: forgedSignature }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });

    const entry = await adminChallenges.findById('challenge-id-2');
    expect(entry?.consumedAt).toBeNull();
    expect(await sessions.findByTokenHash('anything')).toBeNull();

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('PLATFORM_ADMIN_LOGIN_FAILED');

    // Retry-safe: a correct signature against the SAME challenge still works.
    const validSignature = signChallenge('raw-challenge-secret', keyPair.privateKeyPkcs8Pem);
    const result = await verifyAdminChallenge({ challengeId: 'challenge-id-2', signatureBase64: validSignature });
    expect(result.accessToken).toBeDefined();
  });

  it('rejects a garbage (non-base64/non-Ed25519) signature the same as a forged one', async () => {
    const { admins, adminChallenges, verifyAdminChallenge } = buildHarness();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-garbage',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
    });

    await expect(
      verifyAdminChallenge({ challengeId: 'challenge-id-garbage', signatureBase64: '***not-base64***' }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });
  });

  it('rejects an expired challenge even with a valid signature, and never mints a session', async () => {
    const { admins, adminChallenges, sessions, verifyAdminChallenge } = buildHarness();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-3',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
      expiresAt: fromDate(new Date('2025-12-31T23:59:00.000Z')), // before NOW
    });
    const validSignature = signChallenge('raw-challenge-secret', keyPair.privateKeyPkcs8Pem);

    await expect(
      verifyAdminChallenge({ challengeId: 'challenge-id-3', signatureBase64: validSignature }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });

    expect(await sessions.findByTokenHash('anything')).toBeNull();
  });

  it('rejects an unknown challengeId (never appended)', async () => {
    const { verifyAdminChallenge } = buildHarness();

    await expect(
      verifyAdminChallenge({ challengeId: 'never-appended', signatureBase64: 'irrelevant' }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });
  });

  it('rejects a replayed (already-consumed) challengeId — no second session', async () => {
    const { admins, adminChallenges, sessions, verifyAdminChallenge } = buildHarness();
    const keyPair = generateEd25519KeyPair();
    const admin = await seedAdminWithActiveKey(admins, keyPair);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-4',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
    });
    const validSignature = signChallenge('raw-challenge-secret', keyPair.privateKeyPkcs8Pem);

    const first = await verifyAdminChallenge({ challengeId: 'challenge-id-4', signatureBase64: validSignature });
    expect(first.accessToken).toBeDefined();

    await expect(
      verifyAdminChallenge({ challengeId: 'challenge-id-4', signatureBase64: validSignature }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });

    const firstSession = await sessions.findByTokenHash(TOKEN_SERVICE.fingerprint(first.accessToken));
    expect(firstSession).not.toBeNull();
  });

  it('rejects a signature produced by a DEPRECATED (non-ACTIVE) key — only the ACTIVE key verifies', async () => {
    const { admins, adminChallenges, verifyAdminChallenge } = buildHarness();
    const deprecatedKeyPair = generateEd25519KeyPair();
    const activeKeyPair = generateEd25519KeyPair();
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-rotated')),
      email: createEmail('rotated@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-old')),
          publicKey: deprecatedKeyPair.publicKeySpkiPem,
          status: 'DEPRECATED',
          encryptedPrivateKey: null,
          createdAt: CREATED_AT,
          rotatedAt: CREATED_AT,
        }),
        createAdminKey({
          keyId: createAdminKeyId(oid('key-new')),
          publicKey: activeKeyPair.publicKeySpkiPem,
          status: 'ACTIVE',
          encryptedPrivateKey: 'ciphertext',
          createdAt: CREATED_AT,
        }),
      ],
      now: CREATED_AT,
    });
    await admins.save(admin);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-5',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
    });
    const signatureFromDeprecatedKey = signChallenge('raw-challenge-secret', deprecatedKeyPair.privateKeyPkcs8Pem);

    await expect(
      verifyAdminChallenge({ challengeId: 'challenge-id-5', signatureBase64: signatureFromDeprecatedKey }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });

    // The ACTIVE key's signature over the SAME challenge still verifies.
    const signatureFromActiveKey = signChallenge('raw-challenge-secret', activeKeyPair.privateKeyPkcs8Pem);
    const result = await verifyAdminChallenge({
      challengeId: 'challenge-id-5',
      signatureBase64: signatureFromActiveKey,
    });
    expect(result.accessToken).toBeDefined();
  });

  it('rejects a signature produced by a REVOKED key when the admin has no ACTIVE key at all', async () => {
    const { admins, adminChallenges, verifyAdminChallenge } = buildHarness();
    const revokedKeyPair = generateEd25519KeyPair();
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId(oid('admin-revoked')),
      email: createEmail('revoked@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId(oid('key-revoked')),
          publicKey: revokedKeyPair.publicKeySpkiPem,
          status: 'REVOKED',
          encryptedPrivateKey: null,
          createdAt: CREATED_AT,
          revokedAt: CREATED_AT,
        }),
      ],
      now: CREATED_AT,
    });
    await admins.save(admin);
    await appendChallenge(adminChallenges, {
      challengeId: 'challenge-id-6',
      adminOrganizationId: admin.id,
      challenge: 'raw-challenge-secret',
    });
    const signature = signChallenge('raw-challenge-secret', revokedKeyPair.privateKeyPkcs8Pem);

    await expect(
      verifyAdminChallenge({ challengeId: 'challenge-id-6', signatureBase64: signature }),
    ).rejects.toMatchObject({ code: 'ADMIN_CHALLENGE_INVALID' });
  });
});
