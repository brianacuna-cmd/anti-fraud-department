import { createRequestAdminChallengeUseCase } from '../../../../../src/modules/identity-access/application/admin/RequestAdminChallenge.js';
import { AdminOrganization } from '../../../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { InMemoryAdminOrganizationRepository } from '../../../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemoryAdminChallengeStore } from '../../../../helpers/identity-access/InMemoryAdminChallengeStore.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREATED_AT = fromDate(new Date('2025-12-31T00:00:00.000Z'));

function buildHarness() {
  const admins = new InMemoryAdminOrganizationRepository();
  const adminChallenges = new InMemoryAdminChallengeStore();
  const requestAdminChallenge = createRequestAdminChallengeUseCase({
    admins,
    adminChallenges,
    clock: new FixedClock(NOW),
    challengeTtlSeconds: 86_400,
  });
  return { admins, adminChallenges, requestAdminChallenge };
}

async function seedAdminWithActiveKey(admins: InMemoryAdminOrganizationRepository) {
  const admin = AdminOrganization.create({
    id: createAdminOrganizationId('admin-1'),
    email: createEmail('root@platform.internal'),
    keys: [
      createAdminKey({
        keyId: createAdminKeyId('key-1'),
        publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
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

describe('createRequestAdminChallengeUseCase', () => {
  it('appends a challenge and returns challengeId/challenge/expiresAt for an admin with an active key', async () => {
    const { admins, adminChallenges, requestAdminChallenge } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    const result = await requestAdminChallenge({ adminOrganizationId: admin.id });

    expect(result.challengeId).toBeDefined();
    expect(result.challenge).toBeDefined();
    expect(result.challengeId).not.toBe(result.challenge);
    expect(result.expiresAt).toBe('2026-01-02T00:00:00.000Z');

    const stored = await adminChallenges.findById(result.challengeId);
    expect(stored?.challenge).toBe(result.challenge);
    expect(stored?.adminOrganizationId).toBe(admin.id);
    expect(stored?.consumedAt).toBeNull();
  });

  it('generates a fresh, distinct challengeId/challenge pair on every call (no reuse)', async () => {
    const { admins, requestAdminChallenge } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    const first = await requestAdminChallenge({ adminOrganizationId: admin.id });
    const second = await requestAdminChallenge({ adminOrganizationId: admin.id });

    expect(first.challengeId).not.toBe(second.challengeId);
    expect(first.challenge).not.toBe(second.challenge);
  });

  it('rejects an unknown adminOrganizationId with an opaque adminChallengeInvalid (no enumeration oracle)', async () => {
    const { requestAdminChallenge } = buildHarness();

    await expect(requestAdminChallenge({ adminOrganizationId: 'never-provisioned' })).rejects.toMatchObject({
      code: 'ADMIN_CHALLENGE_INVALID',
    });
  });

  it('rejects an admin with no ACTIVE key with the SAME opaque error as unknown id', async () => {
    const { admins, requestAdminChallenge } = buildHarness();
    const admin = AdminOrganization.create({
      id: createAdminOrganizationId('admin-2'),
      email: createEmail('deprecated@platform.internal'),
      keys: [
        createAdminKey({
          keyId: createAdminKeyId('key-2'),
          publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
          status: 'REVOKED',
          encryptedPrivateKey: null,
          createdAt: CREATED_AT,
          revokedAt: CREATED_AT,
        }),
      ],
      now: CREATED_AT,
    });
    await admins.save(admin);

    await expect(requestAdminChallenge({ adminOrganizationId: admin.id })).rejects.toBeInstanceOf(
      IdentityAccessError,
    );
    await expect(requestAdminChallenge({ adminOrganizationId: admin.id })).rejects.toMatchObject({
      code: 'ADMIN_CHALLENGE_INVALID',
    });
  });
});
