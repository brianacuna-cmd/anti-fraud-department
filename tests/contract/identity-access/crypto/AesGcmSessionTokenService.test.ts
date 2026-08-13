import { oid } from '../../../support/oid.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';

function buildService(secret = 'token-secret', keyVersion = 1): AesGcmSessionTokenService {
  return new AesGcmSessionTokenService(new AesGcmSecretCipher(secret, keyVersion));
}

describe('AesGcmSessionTokenService', () => {
  it('issues an opaque token and reads back the exact same payload', () => {
    const service = buildService();

    const token = service.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });

    expect(service.read(token)).toEqual({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });
  });

  it('round-trips a REFRESH token distinctly from an ACCESS token', () => {
    const service = buildService();

    const token = service.issue({ sessionId: oid('session-1'), tokenType: 'REFRESH', keyVersion: 1 });

    expect(service.read(token)).toEqual({ sessionId: oid('session-1'), tokenType: 'REFRESH', keyVersion: 1 });
  });

  it('returns null when reading a tampered token', () => {
    const service = buildService();
    const token = service.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });
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
    const token = service.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });

    const first = service.fingerprint(token);
    const second = service.fingerprint(token);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprint differs for different tokens', () => {
    const service = buildService();
    const tokenA = service.issue({ sessionId: oid('session-a'), tokenType: 'ACCESS', keyVersion: 1 });
    const tokenB = service.issue({ sessionId: oid('session-b'), tokenType: 'ACCESS', keyVersion: 1 });

    expect(service.fingerprint(tokenA)).not.toBe(service.fingerprint(tokenB));
  });

  describe('scoped MFA payloads (design D2, two-step-login)', () => {
    const scopedPayload = {
      tokenType: 'mfa_challenge' as const,
      keyVersion: 1,
      jti: 'jti-1',
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER' as const,
      expiresAt: '2026-01-01T00:05:00.000Z',
    };

    it('round-trips an mfa_challenge payload', () => {
      const service = buildService();

      const token = service.issue(scopedPayload);

      expect(service.read(token)).toEqual(scopedPayload);
    });

    it('round-trips an mfa_enrollment payload with a null organizationId', () => {
      const service = buildService();
      const payload = { ...scopedPayload, tokenType: 'mfa_enrollment' as const, organizationId: null };

      const token = service.issue(payload);

      expect(service.read(token)).toEqual(payload);
    });

    it('returns null when reading a tampered scoped MFA token', () => {
      const service = buildService();
      const token = service.issue(scopedPayload);
      const raw = Buffer.from(token, 'base64url');
      raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff;

      expect(service.read(raw.toString('base64url'))).toBeNull();
    });

    it('returns null for a payload missing jti (wrong-shape reject)', () => {
      const cipher = new AesGcmSecretCipher('token-secret', 1);
      const service = new AesGcmSessionTokenService(cipher);
      const { jti, ...withoutJti } = scopedPayload;
      void jti;
      const badToken = cipher.encrypt(JSON.stringify(withoutJti));

      expect(service.read(badToken)).toBeNull();
    });

    it('an ACCESS token read as scoped MFA payload fields stays a pointer payload, not confused with scoped shape', () => {
      const service = buildService();
      const token = service.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });

      const payload = service.read(token);

      expect(payload).toEqual({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });
    });
  });

  describe('scoped password_reset payload (password-management PR-2a, design §2)', () => {
    const resetPayload = {
      tokenType: 'password_reset' as const,
      keyVersion: 1,
      jti: 'jti-reset-1',
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER' as const,
      expiresAt: '2026-01-01T00:15:00.000Z',
    };

    it('round-trips a password_reset payload', () => {
      const service = buildService();

      const token = service.issue(resetPayload);

      expect(service.read(token)).toEqual(resetPayload);
    });

    it('returns null when reading a tampered password_reset token', () => {
      const service = buildService();
      const token = service.issue(resetPayload);
      const raw = Buffer.from(token, 'base64url');
      raw[raw.length - 1] = (raw[raw.length - 1]! ^ 0xff) & 0xff;

      expect(service.read(raw.toString('base64url'))).toBeNull();
    });

    it('returns null for a payload missing jti (wrong-shape reject)', () => {
      const cipher = new AesGcmSecretCipher('token-secret', 1);
      const service = new AesGcmSessionTokenService(cipher);
      const { jti, ...withoutJti } = resetPayload;
      void jti;
      const badToken = cipher.encrypt(JSON.stringify(withoutJti));

      expect(service.read(badToken)).toBeNull();
    });

    it('rejects a password_reset payload with a null organizationId (unlike scoped MFA, this arm requires a string)', () => {
      const cipher = new AesGcmSecretCipher('token-secret', 1);
      const service = new AesGcmSessionTokenService(cipher);
      const badToken = cipher.encrypt(JSON.stringify({ ...resetPayload, organizationId: null }));

      expect(service.read(badToken)).toBeNull();
    });

    it('an ACCESS/mfa payload is never misidentified as password_reset, and vice versa (regression guard, PR-2a task 7)', () => {
      const service = buildService();
      const accessToken = service.issue({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });
      const mfaToken = service.issue({
        tokenType: 'mfa_challenge',
        keyVersion: 1,
        jti: 'jti-mfa-1',
        userId: oid('user-1'),
        organizationId: oid('org-1'),
        actorType: 'USER',
        expiresAt: '2026-01-01T00:05:00.000Z',
      });
      const resetToken = service.issue(resetPayload);

      expect(service.read(accessToken)).toEqual({ sessionId: oid('session-1'), tokenType: 'ACCESS', keyVersion: 1 });
      expect((service.read(mfaToken) as { tokenType: string }).tokenType).toBe('mfa_challenge');
      expect((service.read(resetToken) as { tokenType: string }).tokenType).toBe('password_reset');
    });
  });
});
