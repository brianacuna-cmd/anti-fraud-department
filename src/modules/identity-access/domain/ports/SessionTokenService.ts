export type SessionTokenType = 'ACCESS' | 'REFRESH';

/**
 * What an opaque token actually carries (design D13). The `Sessions` row is
 * read every request anyway, so the token is a POINTER, never the actor's
 * identity — `tokenType` alone is what stops an access token being
 * presented at `/auth/refresh` (checked before the rotation table runs).
 */
export interface SessionTokenPayload {
  readonly sessionId: string;
  readonly tokenType: SessionTokenType;
  readonly keyVersion: number;
}

/**
 * Issues/reads/fingerprints opaque session tokens (design D13). COMPOSES a
 * `SecretCipher` — this port owns no crypto primitive of its own beyond the
 * `fingerprint` hash, which is a distinct, unrelated hashing concern (SHA-256
 * of the whole token), not the AES-256-GCM primitive `SecretCipher` guards.
 */
export interface SessionTokenService {
  /** Encrypts `payload` into an opaque token string. */
  issue(payload: SessionTokenPayload): string;

  /** Decrypts and validates `token`'s shape. Returns `null` on any failure — never throws. */
  read(token: string): SessionTokenPayload | null;

  /** SHA-256 hex digest of the raw token — what `Sessions.TokenHash`/`RefreshTokenHash` store. */
  fingerprint(token: string): string;
}
