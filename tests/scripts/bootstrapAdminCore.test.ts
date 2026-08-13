import { oid } from '../support/oid.js';
import { runBootstrapAdmin } from '../../scripts/bootstrapAdminCore.js';
import { InMemoryAdminOrganizationRepository } from '../helpers/identity-access/InMemoryAdminOrganizationRepository.js';
import { InMemoryAuditRecorder } from '../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakeAdminKeyPairGenerator } from '../helpers/identity-access/FakeAdminKeyPairGenerator.js';
import { AesGcmSecretCipher } from '../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { createAdminOrganizationId } from '../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildDeps() {
  const admins = new InMemoryAdminOrganizationRepository();
  const keyPairs = new FakeAdminKeyPairGenerator();
  const cipher = new AesGcmSecretCipher('bootstrap-test-secret', 1);
  const auditRecorder = new InMemoryAuditRecorder();
  const clock = new FixedClock(NOW);
  let nextOrgIdSeq = 0;
  let nextKeyIdSeq = 0;
  const deps = {
    admins,
    keyPairs,
    cipher,
    auditRecorder,
    clock,
    generateAdminOrganizationId: () => {
      nextOrgIdSeq += 1;
      return createAdminOrganizationId(oid(`admin-org-${nextOrgIdSeq}`));
    },
    generateAdminKeyId: () => {
      nextKeyIdSeq += 1;
      return createAdminKeyId(oid(`admin-key-${nextKeyIdSeq}`));
    },
  };
  return { deps, admins, cipher, auditRecorder };
}

describe('runBootstrapAdmin', () => {
  it('provisions admin #0 on an empty system and returns the plaintext private key', async () => {
    const { deps, admins, cipher, auditRecorder } = buildDeps();

    const result = await runBootstrapAdmin(deps, { email: 'root@platform.internal' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.admin.email).toBe('root@platform.internal');
    expect(result.admin.keys).toHaveLength(1);
    expect(result.admin.keys[0]?.status).toBe('ACTIVE');
    expect(result.privateKeyPkcs8Pem).toContain('BEGIN PRIVATE KEY');

    const persisted = await admins.findById(result.admin.id);
    expect(persisted?.id).toBe(result.admin.id);
    // The stored key is ciphertext only — never the plaintext handed back to the operator.
    const encrypted = persisted?.keys[0]?.encryptedPrivateKey ?? null;
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toContain('BEGIN PRIVATE KEY');
    expect(cipher.decrypt(encrypted!)).toBe(result.privateKeyPkcs8Pem);

    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]).toMatchObject({
      organizationId: null,
      action: 'PLATFORM_ADMIN_PROVISIONED',
      resource: 'adminOrganizations',
      resourceId: result.admin.id,
    });
  });

  it('refuses a second run when an AdminOrganization already exists, without mutating anything', async () => {
    const { deps, admins, auditRecorder } = buildDeps();

    const first = await runBootstrapAdmin(deps, { email: 'root@platform.internal' });
    expect(first.ok).toBe(true);

    const countAfterFirst = await admins.countAll();
    const auditCountAfterFirst = auditRecorder.all().length;

    const second = await runBootstrapAdmin(deps, { email: 'someone-else@platform.internal' });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/already exists/i);
    expect(await admins.countAll()).toBe(countAfterFirst);
    expect(auditRecorder.all()).toHaveLength(auditCountAfterFirst);
  });
});
