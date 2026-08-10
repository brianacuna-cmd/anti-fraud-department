import { createHash } from 'node:crypto';
import type { SecretCipher } from '../../../../domain/ports/SecretCipher.js';
import type { SessionTokenPayload, SessionTokenService } from '../../../../domain/ports/SessionTokenService.js';

const POINTER_TOKEN_TYPES = new Set(['ACCESS', 'REFRESH']);
const SCOPED_MFA_TOKEN_TYPES = new Set(['mfa_challenge', 'mfa_enrollment']);
const SCOPED_PASSWORD_RESET_TOKEN_TYPES = new Set(['password_reset']);

function isSessionPointerPayload(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate.sessionId === 'string' &&
    typeof candidate.tokenType === 'string' &&
    POINTER_TOKEN_TYPES.has(candidate.tokenType) &&
    typeof candidate.keyVersion === 'number'
  );
}

/**
 * Two-step-login PR1a (design D2): validates the discriminated union's other
 * arm — a self-contained scoped MFA claim, never a `Sessions` pointer.
 */
function isScopedMfaPayload(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate.tokenType === 'string' &&
    SCOPED_MFA_TOKEN_TYPES.has(candidate.tokenType) &&
    typeof candidate.keyVersion === 'number' &&
    typeof candidate.jti === 'string' &&
    typeof candidate.userId === 'string' &&
    (candidate.organizationId === null || typeof candidate.organizationId === 'string') &&
    candidate.actorType === 'USER' &&
    typeof candidate.expiresAt === 'string'
  );
}

/**
 * password-management PR-2a (design §2): validates the discriminated
 * union's third arm — a self-contained single-use password-reset claim.
 * Unlike `isScopedMfaPayload`, `organizationId` MUST be a `string` (never
 * `null`) — a reset token is only ever minted for an already-resolved
 * user+tenant pair.
 */
function isScopedPasswordResetPayload(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate.tokenType === 'string' &&
    SCOPED_PASSWORD_RESET_TOKEN_TYPES.has(candidate.tokenType) &&
    typeof candidate.keyVersion === 'number' &&
    typeof candidate.jti === 'string' &&
    typeof candidate.userId === 'string' &&
    typeof candidate.organizationId === 'string' &&
    candidate.actorType === 'USER' &&
    typeof candidate.expiresAt === 'string'
  );
}

function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isSessionPointerPayload(candidate) ||
    isScopedMfaPayload(candidate) ||
    isScopedPasswordResetPayload(candidate)
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
