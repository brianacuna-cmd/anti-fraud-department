import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';

function buildService(secret = 'token-secret', keyVersion = 1): AesGcmSessionTokenService {
  return new AesGcmSessionTokenService(new AesGcmSecretCipher(secret, keyVersion));
}

describe('AesGcmSessionTokenService', () => {
  it('issues an opaque token and reads back the exact same payload', () => {
    const service = buildService();

    const token = service.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });

    expect(service.read(token)).toEqual({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });
  });

  it('round-trips a REFRESH token distinctly from an ACCESS token', () => {
    const service = buildService();

    const token = service.issue({ sessionId: 'session-1', tokenType: 'REFRESH', keyVersion: 1 });

    expect(service.read(token)).toEqual({ sessionId: 'session-1', tokenType: 'REFRESH', keyVersion: 1 });
  });

  it('returns null when reading a tampered token', () => {
    const service = buildService();
    const token = service.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });
    const raw = Buffer.from(token, 'base64url');
    raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff;

    expect(service.read(raw.toString('base64url'))).toBeNull();
  });

  it('returns null for garbage input instead of throwing', () => {
    const service = buildService();

    expect(service.read('not-a-real-token')).toBeNull();
  });

  it('returns null when the decrypted plaintext is not a valid SessionTokenPayload shape', () => {
    const cipher = new AesGcmSecretCipher('token-secret', 1);
    const service = new AesGcmSessionTokenService(cipher);
    const badToken = cipher.encrypt(JSON.stringify({ notAPayload: true }));

    expect(service.read(badToken)).toBeNull();
  });

  it('fingerprint is a deterministic 64-char SHA-256 hex digest', () => {
    const service = buildService();
    const token = service.issue({ sessionId: 'session-1', tokenType: 'ACCESS', keyVersion: 1 });

    const first = service.fingerprint(token);
    const second = service.fingerprint(token);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint differs for different tokens', () => {
    const service = buildService();
    const tokenA = service.issue({ sessionId: 'session-a', tokenType: 'ACCESS', keyVersion: 1 });
    const tokenB = service.issue({ sessionId: 'session-b', tokenType: 'ACCESS', keyVersion: 1 });

    expect(service.fingerprint(tokenA)).not.toBe(service.fingerprint(tokenB));
  });
});
