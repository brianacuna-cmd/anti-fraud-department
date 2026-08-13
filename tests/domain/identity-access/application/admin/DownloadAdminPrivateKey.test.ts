import { oid } from '../../../../support/oid.js';
import { createDownloadAdminPrivateKeyUseCase } from '../../../../../src/modules/identity-access/application/admin/DownloadAdminPrivateKey.js';
import { AdminOrganization } from '../../../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { AesGcmSecretCipher } from '../../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { InMemoryAdminOrganizationRepository } from '../../../../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemoryUnitOfWork } from '../../../../helpers/identity-access/InMemoryUnitOfWork.js';
import { InMemoryAuditRecorder } from '../../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const CREATED_AT = fromDate(new Date('2025-12-31T00:00:00.000Z'));
const PLATFORM_ADMIN = createAuthContext({ userId: oid('admin-caller'), organizationId: null, isPlatformAdmin: true });
const REGULAR_USER = createAuthContext({ userId: oid('user-1'), organizationId: oid('o1'), isPlatformAdmin: false });
const CIPHER = new AesGcmSecretCipher('download-admin-private-key-test-secret', 1);
const PLAINTEXT_PEM = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n';

function buildHarness() {
  const admins = new InMemoryAdminOrganizationRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auditRecorder = new InMemoryAuditRecorder();
  const downloadAdminPrivateKey = createDownloadAdminPrivateKeyUseCase({
    admins,
    cipher: CIPHER,
    unitOfWork,
    clock: new FixedClock(NOW),
    auditRecorder,
  });
  return { admins, unitOfWork, auditRecorder, downloadAdminPrivateKey };
}

async function seedAdminWithKey(admins: InMemoryAdminOrganizationRepository, id = oid('admin-1')) {
  const admin = AdminOrganization.create({
    id: createAdminOrganizationId(id),
    email: createEmail('root@platform.internal'),
    keys: [
      createAdminKey({
        keyId: createAdminKeyId(oid('key-1')),
        publicKey: '-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n',
        status: 'ACTIVE',
        encryptedPrivateKey: CIPHER.encrypt(PLAINTEXT_PEM),
        createdAt: CREATED_AT,
      }),
    ],
    now: CREATED_AT,
  });
  await admins.save(admin);
  return admin;
}

describe('createDownloadAdminPrivateKeyUseCase', () => {
  it('claims, decrypts, and returns the private key PEM exactly once', async () => {
    const { admins, auditRecorder, downloadAdminPrivateKey } = buildHarness();
    const admin = await seedAdminWithKey(admins);

    const result = await downloadAdminPrivateKey({
      auth: PLATFORM_ADMIN,
      adminOrganizationId: admin.id,
      keyId: oid('key-1'),
    });

    expect(result.privateKeyPkcs8Pem).toBe(PLAINTEXT_PEM);

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('PLATFORM_ADMIN_PRIVATE_KEY_DOWNLOADED');
    expect(calls[0].tx).toBeDefined();

    // The key is nulled at rest — never a decryptable copy remains.
    const reloaded = await admins.findById(admin.id);
    expect(reloaded?.findKey(createAdminKeyId(oid('key-1')))?.encryptedPrivateKey).toBeNull();
  });

  it('rejects a second download of the same key (already claimed)', async () => {
    const { admins, downloadAdminPrivateKey } = buildHarness();
    const admin = await seedAdminWithKey(admins);

    await downloadAdminPrivateKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    await expect(
      downloadAdminPrivateKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') }),
    ).rejects.toMatchObject({ code: 'ADMIN_PRIVATE_KEY_UNAVAILABLE' });
  });

  it('rejects an unknown adminOrganizationId with ADMIN_ORGANIZATION_NOT_FOUND', async () => {
    const { downloadAdminPrivateKey } = buildHarness();

    await expect(
      downloadAdminPrivateKey({ auth: PLATFORM_ADMIN, adminOrganizationId: oid('missing-admin'), keyId: oid('key-1') }),
    ).rejects.toMatchObject({ code: 'ADMIN_ORGANIZATION_NOT_FOUND' });
  });

  it('rejects an unknown keyId with ADMIN_PRIVATE_KEY_UNAVAILABLE', async () => {
    const { admins, downloadAdminPrivateKey } = buildHarness();
    const admin = await seedAdminWithKey(admins);

    await expect(
      downloadAdminPrivateKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('nonexistent') }),
    ).rejects.toMatchObject({ code: 'ADMIN_PRIVATE_KEY_UNAVAILABLE' });
  });

  it('rejects a non-platform-admin caller with FORBIDDEN_CROSS_TENANT', async () => {
    const { admins, downloadAdminPrivateKey } = buildHarness();
    const admin = await seedAdminWithKey(admins);

    await expect(
      downloadAdminPrivateKey({ auth: REGULAR_USER, adminOrganizationId: admin.id, keyId: oid('key-1') }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('never logs or leaks the private key in the audit detail', async () => {
    const { admins, auditRecorder, downloadAdminPrivateKey } = buildHarness();
    const admin = await seedAdminWithKey(admins);

    await downloadAdminPrivateKey({ auth: PLATFORM_ADMIN, adminOrganizationId: admin.id, keyId: oid('key-1') });

    const detailString = JSON.stringify(auditRecorder.calls()[0]!.event.detail);
    expect(detailString).not.toContain('BEGIN PRIVATE KEY');
    expect(detailString).not.toContain(PLAINTEXT_PEM);
  });
});
