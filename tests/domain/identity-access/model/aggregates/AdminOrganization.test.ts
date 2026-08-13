import { oid } from '../../../../support/oid.js';
import { AdminOrganization } from '../../../../../src/modules/identity-access/domain/model/aggregates/AdminOrganization.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { createAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { createAdminKey, type AdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function activeKey(keyId = oid('key-1')): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(keyId),
    publicKey: `pub-${keyId}`,
    status: 'ACTIVE',
    encryptedPrivateKey: `cipher-${keyId}`,
    createdAt: NOW,
  });
}

function deprecatedKey(keyId = oid('key-0')): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(keyId),
    publicKey: `pub-${keyId}`,
    status: 'DEPRECATED',
    encryptedPrivateKey: null,
    createdAt: NOW,
    rotatedAt: NOW,
  });
}

function revokedKey(keyId = oid('key-revoked')): AdminKey {
  return createAdminKey({
    keyId: createAdminKeyId(keyId),
    publicKey: `pub-${keyId}`,
    status: 'REVOKED',
    encryptedPrivateKey: null,
    createdAt: NOW,
    revokedAt: NOW,
  });
}

function buildAdminOrganization(keys: readonly AdminKey[] = [activeKey()]): AdminOrganization {
  return AdminOrganization.create({
    id: createAdminOrganizationId(oid('admin-org-1')),
    email: createEmail('root@platform.test'),
    keys,
    now: NOW,
  });
}

describe('AdminOrganization.create', () => {
  it('creates an admin organization with matching created/updated timestamps', () => {
    const admin = buildAdminOrganization();

    expect(admin.email).toBe('root@platform.test');
    expect(admin.keys).toHaveLength(1);
    expect(admin.createdAt).toBe(NOW);
    expect(admin.updatedAt).toBe(NOW);
  });

  it('rejects a second ACTIVE key as an invariant violation (D31a)', () => {
    expect(() => buildAdminOrganization([activeKey(oid('key-1')), activeKey(oid('key-2'))])).toThrow(
      IdentityAccessError,
    );
    expect(() => buildAdminOrganization([activeKey(oid('key-1')), activeKey(oid('key-2'))])).toThrow(
      /INVARIANT_VIOLATION|ACTIVE/,
    );
  });

  it('allows zero ACTIVE keys (e.g. all deprecated/revoked)', () => {
    expect(() => buildAdminOrganization([deprecatedKey(), revokedKey()])).not.toThrow();
  });
});

describe('AdminOrganization.rehydrate', () => {
  it('reconstructs from stored props without re-validating business rules, even with 2 ACTIVE keys', () => {
    const admin = AdminOrganization.rehydrate({
      id: createAdminOrganizationId(oid('admin-org-1')),
      email: createEmail('root@platform.test'),
      keys: [activeKey(oid('key-1')), activeKey(oid('key-2'))],
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(admin.keys).toHaveLength(2);
    expect(admin.updatedAt).toBe(LATER);
  });
});

describe('AdminOrganization#activeKey', () => {
  it('returns the single ACTIVE key', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1')), deprecatedKey(oid('key-0'))]);

    expect(admin.activeKey()?.keyId).toBe(oid('key-1'));
  });

  it('returns null when no key is ACTIVE', () => {
    const admin = buildAdminOrganization([deprecatedKey(), revokedKey()]);

    expect(admin.activeKey()).toBeNull();
  });

  it('throws INVARIANT_VIOLATION on a hand-built aggregate with 2 ACTIVE keys (fail-closed accessor, D31a)', () => {
    const corrupt = AdminOrganization.rehydrate({
      id: createAdminOrganizationId(oid('admin-org-1')),
      email: createEmail('root@platform.test'),
      keys: [activeKey(oid('key-1')), activeKey(oid('key-2'))],
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(() => corrupt.activeKey()).toThrow(IdentityAccessError);
  });
});

describe('AdminOrganization#findKey', () => {
  it('finds a key by id', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1')), deprecatedKey(oid('key-0'))]);

    expect(admin.findKey(createAdminKeyId(oid('key-0')))?.status).toBe('DEPRECATED');
  });

  it('returns null when no key matches', () => {
    const admin = buildAdminOrganization();

    expect(admin.findKey(createAdminKeyId(oid('missing')))).toBeNull();
  });
});

describe('AdminOrganization#rotateKey', () => {
  it('demotes exactly one ACTIVE to DEPRECATED and appends the new ACTIVE key (D33)', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1'))]);

    const rotated = admin.rotateKey(activeKey(oid('key-2')), LATER);

    expect(rotated).not.toBe(admin);
    expect(rotated.keys).toHaveLength(2);
    expect(rotated.findKey(createAdminKeyId(oid('key-1')))?.status).toBe('DEPRECATED');
    expect(rotated.findKey(createAdminKeyId(oid('key-1')))?.rotatedAt).toBe(LATER);
    expect(rotated.findKey(createAdminKeyId(oid('key-2')))?.status).toBe('ACTIVE');
    expect(rotated.activeKey()?.keyId).toBe(oid('key-2'));
    expect(rotated.updatedAt).toBe(LATER);
    // original instance is untouched
    expect(admin.activeKey()?.keyId).toBe(oid('key-1'));
  });

  it('rejects rotating in a non-ACTIVE new key as an invariant violation', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1'))]);

    expect(() => admin.rotateKey(deprecatedKey(oid('key-2')), LATER)).toThrow(IdentityAccessError);
  });
});

describe('AdminOrganization#revokeKey', () => {
  it('marks the key REVOKED with revokedAt set', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1'))]);

    const revoked = admin.revokeKey(createAdminKeyId(oid('key-1')), LATER);

    expect(revoked).not.toBe(admin);
    expect(revoked.findKey(createAdminKeyId(oid('key-1')))?.status).toBe('REVOKED');
    expect(revoked.findKey(createAdminKeyId(oid('key-1')))?.revokedAt).toBe(LATER);
    expect(revoked.updatedAt).toBe(LATER);
  });

  it('is terminal — revoking an already-REVOKED key throws an invariant violation', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1'))]).revokeKey(createAdminKeyId(oid('key-1')), LATER);

    expect(() => admin.revokeKey(createAdminKeyId(oid('key-1')), LATER)).toThrow(IdentityAccessError);
  });

  it('throws when the keyId does not exist on the aggregate', () => {
    const admin = buildAdminOrganization();

    expect(() => admin.revokeKey(createAdminKeyId(oid('missing')), LATER)).toThrow(IdentityAccessError);
  });
});

describe('AdminOrganization#markPrivateKeyDownloaded', () => {
  it('sets privateKeyDownloadedAt and clears encryptedPrivateKey', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1'))]);

    const claimed = admin.markPrivateKeyDownloaded(createAdminKeyId(oid('key-1')), LATER);

    const key = claimed.findKey(createAdminKeyId(oid('key-1')));
    expect(key?.privateKeyDownloadedAt).toBe(LATER);
    expect(key?.encryptedPrivateKey).toBeNull();
  });

  it('throws when the key was already downloaded (one-time, D32a)', () => {
    const admin = buildAdminOrganization([activeKey(oid('key-1'))]).markPrivateKeyDownloaded(
      createAdminKeyId(oid('key-1')),
      LATER,
    );

    expect(() => admin.markPrivateKeyDownloaded(createAdminKeyId(oid('key-1')), LATER)).toThrow(
      IdentityAccessError,
    );
  });
});
