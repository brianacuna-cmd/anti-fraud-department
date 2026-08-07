import { createHash } from 'node:crypto';
import type { SecretCipher } from '../../../../domain/ports/SecretCipher.js';
import type { SessionTokenPayload, SessionTokenService } from '../../../../domain/ports/SessionTokenService.js';

const VALID_TOKEN_TYPES = new Set(['ACCESS', 'REFRESH']);

function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.tokenType === 'string' &&
    VALID_TOKEN_TYPES.has(candidate.tokenType) &&
    typeof candidate.keyVersion === 'number'
  );
}

/**
 * The only `SessionTokenService` implementation (design D13) — COMPOSES a
 * `SecretCipher` for `issue`/`read` rather than touching AES itself, making
 * primitive-reuse structural. `fingerprint` is a plain SHA-256 hex digest of
 * the raw token string, unrelated to the AES-256-GCM primitive.
 */
export class AesGcmSessionTokenService implements SessionTokenService {
  constructor(private readonly secretCipher: SecretCipher) {}

  issue(payload: SessionTokenPayload): string {
    return this.secretCipher.encrypt(JSON.stringify(payload));
  }

  read(token: string): SessionTokenPayload | null {
    const plaintext = this.secretCipher.decrypt(token);
    if (plaintext === null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(plaintext);
      return isSessionTokenPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  fingerprint(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
