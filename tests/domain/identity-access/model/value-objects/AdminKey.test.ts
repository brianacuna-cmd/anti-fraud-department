import { oid } from '../../../../support/oid.js';
import { createAdminKey } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKey.js';
import { createAdminKeyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function baseInput() {
  return {
    keyId: createAdminKeyId(oid('key-1')),
    publicKey: '-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----',
    status: 'ACTIVE' as const,
    encryptedPrivateKey: 'ciphertext',
    createdAt: NOW,
  };
}

describe('createAdminKey', () => {
  it('creates a key with the given fields, defaulting nullable timestamps to null', () => {
    const key = createAdminKey(baseInput());

    expect(key.keyId).toBe(oid('key-1'));
    expect(key.publicKey).toBe(baseInput().publicKey);
    expect(key.status).toBe('ACTIVE');
    expect(key.encryptedPrivateKey).toBe('ciphertext');
    expect(key.privateKeyDownloadedAt).toBeNull();
    expect(key.createdAt).toBe(NOW);
    expect(key.rotatedAt).toBeNull();
    expect(key.revokedAt).toBeNull();
  });

  it('rejects an empty publicKey as an invariant violation', () => {
    expect(() => createAdminKey({ ...baseInput(), publicKey: '   ' })).toThrow(/non-empty/);
  });

  it('allows a null encryptedPrivateKey (one-time download already claimed it)', () => {
    const key = createAdminKey({ ...baseInput(), encryptedPrivateKey: null });

    expect(key.encryptedPrivateKey).toBeNull();
  });

  it('allows explicit privateKeyDownloadedAt/rotatedAt/revokedAt to be provided', () => {
    const key = createAdminKey({
      ...baseInput(),
      encryptedPrivateKey: null,
      privateKeyDownloadedAt: NOW,
      rotatedAt: NOW,
      revokedAt: NOW,
    });

    expect(key.privateKeyDownloadedAt).toBe(NOW);
    expect(key.rotatedAt).toBe(NOW);
    expect(key.revokedAt).toBe(NOW);
  });
});
