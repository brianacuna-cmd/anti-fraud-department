import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';
import type { ScopedMfaTokenType } from './SessionTokenService.js';

/**
 * What `append` persists for a newly-minted `mfa_challenge`/
 * `mfa_enrollment` token (design D1, two-step-login) — mirrors the claims
 * ridden inside the token itself (`ScopedMfaPayload`) plus the bookkeeping
 * `consume` needs. USER-only (design: forced enrollment/challenge is a
 * USER-tier concern; `ORGANIZATION` never branches on MFA).
 */
export interface MfaChallengeRecord {
  readonly jti: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly actorType: 'USER';
  readonly tokenType: ScopedMfaTokenType;
  readonly expiresAt: Instant;
  readonly now: Instant;
}

/**
 * Single-use tracking store for `mfa_challenge`/`mfa_enrollment` tokens
 * (design D1). `append` records a freshly-minted token; `consume` is the
 * ATOMIC compare-and-set every mint-a-session flow relies on for
 * replay-safety — exactly one caller may ever observe `true` for a given
 * `jti`, mirroring `SessionRepository.markRotated`'s CAS contract (design
 * D15's identical shape, applied here to jti consumption instead of
 * rotation).
 */
export interface MfaChallengeStore {
  append(record: MfaChallengeRecord, tx?: Transaction): Promise<void>;

  /**
   * Atomic compare-and-set consume: `true` only for the ONE caller that
   * wins — the row exists, is not yet consumed, and has not expired as of
   * `now`. Every other caller (replay, unknown jti, expired) gets `false`.
   */
  consume(jti: string, now: Instant, tx?: Transaction): Promise<boolean>;
}
