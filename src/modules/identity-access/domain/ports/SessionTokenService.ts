export type SessionTokenType = 'ACCESS' | 'REFRESH';
export type ScopedMfaTokenType = 'mfa_challenge' | 'mfa_enrollment';
export type PasswordResetTokenType = 'password_reset';

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
 * Self-contained claims payload for a single-use password-reset token
 * (password-management PR-2a, design §2) — same lifecycle as
 * `ScopedMfaPayload` (self-describing, jti-tracked, self-expiring), but
 * `organizationId` is a required `string` here: unlike the mfa arms (which
 * can be minted before a tenant is known), a reset is always issued for an
 * already-resolved user+tenant pair.
 */
export interface ScopedPasswordResetPayload {
  readonly tokenType: PasswordResetTokenType;
  readonly keyVersion: number;
  readonly jti: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly actorType: 'USER';
  /** ISO-8601 `Instant` string. */
  readonly expiresAt: string;
}

/**
 * What an opaque token actually carries (design D2/D13, two-step-login;
 * password-management PR-2a §2) — a discriminated union on `tokenType`.
 * `ACCESS`/`REFRESH` stay pointers; `mfa_challenge`/`mfa_enrollment`/
 * `password_reset` are self-contained scoped claims.
 */
export type SessionTokenPayload = SessionPointerPayload | ScopedMfaPayload | ScopedPasswordResetPayload;

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
