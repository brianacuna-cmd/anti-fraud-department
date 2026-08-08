export type SessionTokenType = 'ACCESS' | 'REFRESH';
export type ScopedMfaTokenType = 'mfa_challenge' | 'mfa_enrollment';

/**
 * Pointer payload for a real `Sessions` row (design D13). The `Sessions` row
 * is read every request anyway, so the token is a POINTER, never the actor's
 * identity — `tokenType` alone is what stops an access token being
 * presented at `/auth/refresh` (checked before the rotation table runs).
 */
export interface SessionPointerPayload {
  readonly sessionId: string;
  readonly tokenType: SessionTokenType;
  readonly keyVersion: number;
}

/**
 * Self-contained claims payload for a single-use MFA token (design D2,
 * two-step-login). Unlike `SessionPointerPayload`, there is no `Sessions`
 * row behind an `mfa_challenge`/`mfa_enrollment` token — identity, `jti`,
 * and expiry must all ride in the encrypted claim itself. `jti` is the
 * primary key of the `MfaChallenges` single-use tracking store; `expiresAt`
 * lets the token be self-expiring even before a store lookup happens.
 */
export interface ScopedMfaPayload {
  readonly tokenType: ScopedMfaTokenType;
  readonly keyVersion: number;
  readonly jti: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly actorType: 'USER';
  /** ISO-8601 `Instant` string — ONLY USER tier mints these (design: forced enrollment/challenge is USER-only). */
  readonly expiresAt: string;
}

/**
 * What an opaque token actually carries (design D2/D13, two-step-login) — a
 * discriminated union on `tokenType`. `ACCESS`/`REFRESH` stay pointers;
 * `mfa_challenge`/`mfa_enrollment` are self-contained scoped claims.
 */
export type SessionTokenPayload = SessionPointerPayload | ScopedMfaPayload;

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
