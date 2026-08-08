import { createRotateAdminKeyUseCase } from '../../../../../src/modules/identity-access/application/admin/RotateAdminKey.js';
import { AdminOrganization } from '../../../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId, generateAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { InMemoryAdminOrganizationRepository } from '../../../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemorySessionRepository } from '../../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakeAdminKeyPairGenerator } from '../../../../helpers/identity-access/FakeAdminKeyPairGenerator.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';
import { Session } from '../../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREATED_AT = fromDate(new Date('2025-12-31T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: 'admin-caller', organizationId: null, isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: 'user-1', organizationId: 'o1', isPlatformAdmin: false });
const CIPHER = new AesGcmSecretCipher('rotate-admin-key-test-secret', 1);

function buildHarness() {
  const admins = new InMemoryAdminOrganizationRepository();
  const sessions = new InMemorySessionRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const keyPairs = new FakeAdminKeyPairGenerator();
  const rotateAdminKey = createRotateAdminKeyUseCase({
    admins,
    sessions,
    keyPairs,
    cipher: CIPHER,
    unitOfWork,
    clock: new FixedClock(NOW),
    generateAdminKeyId,
    auditRecorder,
  });
  return { admins, sessions, unitOfWork, auditRecorder, keyPairs, rotateAdminKey };
}

async function seedAdminWithActiveKey(admins: InMemoryAdminOrganizationRepository, id = 'admin-1') {
  const admin = AdminOrganization.create({
    id: createAdminOrganizationId(id),
    email: createEmail('root@platform.internal'),
    keys: [
      createAdminKey({
        keyId: createAdminKeyId('key-old'),
        publicKey: '-----BEGIN PUBLIC KEY-----\nold\n-----END PUBLIC KEY-----\n',
        status: 'ACTIVE',
        encryptedPrivateKey: CIPHER.encrypt('old-private-pem'),
        createdAt: CREATED_AT,
      }),
    ],
    now: CREATED_AT,
  });
  await admins.save(admin);
  return admin;
}

async function seedSessionForAdmin(sessions: InMemorySessionRepository, adminId: string) {
  const session = Session.create({
    id: createSessionId('session-1'),
    familyId: createFamilyId('family-1'),
    userId: adminId,
    organizationId: null,
    actorType: 'PLATFORM_ADMIN',
    tokenHash: 'token-hash',
    refreshTokenHash: null,
    expiresAt: fromDate(new Date('2026-02-01T00:00:00.000Z')),
    refreshExpiresAt: null,
    familyExpiresAt: fromDate(new Date('2026-03-01T00:00:00.000Z')),
    now: CREATED_AT,
  });
  await sessions.save(session);
  return session;
}

describe('createRotateAdminKeyUseCase', () => {
  it('demotes the current ACTIVE key to DEPRECATED and activates a freshly generated key', async () => {
    const { admins, rotateAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    const rotated = await rotateAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id });

    expect(rotated.keys).toHaveLength(2);
    const old = rotated.findKey(createAdminKeyId('key-old'));
    expect(old?.status).toBe('DEPRECATED');
    expect(old?.rotatedAt).toBe(NOW);
    expect(rotated.activeKey()?.status).toBe('ACTIVE');
    expect(rotated.activeKey()?.keyId).not.toBe('key-old');

    // at most one ACTIVE key
    const activeCount = rotated.keys.filter((k) => k.status === 'ACTIVE').length;
    expect(activeCount).toBe(1);
  });

  it('persists the rotated aggregate', async () => {
    const { admins, rotateAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await rotateAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id });

    const reloaded = await admins.findById(admin.id);
    expect(reloaded?.activeKey()).not.toBeNull();
    expect(reloaded?.keys).toHaveLength(2);
  });

  it('cascades: revokes every existing session for this admin (D40)', async () => {
    const { admins, sessions, rotateAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);
    const session = await seedSessionForAdmin(sessions, admin.id);
    expect(session.deletedAt).toBeNull();

    await rotateAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id });

    const reloadedSession = await sessions.findByTokenHash('token-hash');
    expect(reloadedSession?.deletedAt).toBe(NOW);
  });

  it('records a PLATFORM_ADMIN_KEY_ROTATED audit event inside the transaction', async () => {
    const { admins, auditRecorder, rotateAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await rotateAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('PLATFORM_ADMIN_KEY_ROTATED');
    expect(calls[0].tx).toBeDefined();
  });

  it('rejects an unknown adminOrganizationId with ADMIN_ORGANIZATION_NOT_FOUND', async () => {
    const { rotateAdminKey } = buildHarness();

    await expect(
      rotateAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: 'missing-admin' }),
    ).rejects.toMatchObject({ code: 'ADMIN_ORGANIZATION_NOT_FOUND' });
  });

  it('rejects a non-platform-admin caller with FORBIDDEN_CROSS_TENANT', async () => {
    const { admins, rotateAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await expect(
      rotateAdminKey({ auth: REGULAR_USER, adminOrganizationId: admin.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('never persists the new private key in plaintext', async () => {
    const { admins, rotateAdminKey } = buildHarness();
    const admin = await seedAdminWithActiveKey(admins);

    await rotateAdminKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id });

    const reloaded = await admins.findById(admin.id);
    const newKeyCiphertext = reloaded?.activeKey()?.encryptedPrivateKey;
    expect(newKeyCiphertext).not.toBeNull();
    expect(newKeyCiphertext).not.toContain('BEGIN PRIVATE KEY');
  });
});
