import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * What `append` persists for a freshly-issued PLATFORM_ADMIN login challenge
 * (design super-admin-auth, mirrors `MfaChallengeRecord`). `challengeId` is
 * the store key (the store's `_id`) — deliberately SEPARATE from `challenge`
 * (the random secret the client must sign) so the store key never doubles
 * as the signed secret (design: "avoids leaking the store key").
 */
export interface AdminChallengeRecord {
  readonly challengeId: string;
  readonly adminOrganizationId: string;
  readonly challenge: string;
  readonly expiresAt: Instant;
  readonly now: Instant;
}

/** A previously-appended challenge, as read back by `findById`. */
export interface AdminChallengeEntry extends AdminChallengeRecord {
  readonly consumedAt: Instant | null;
}

/**
 * Single-use tracking store for PLATFORM_ADMIN login challenges (design
 * super-admin-auth). Mirrors `MfaChallengeStore` exactly: `append` records a
 * freshly-issued challenge; `consume` is the ATOMIC compare-and-set every
 * challenge-verification flow relies on for replay-safety — exactly one
 * caller may ever observe `true` for a given `challengeId`.
 */
export interface AdminChallengeStore {
  append(record: AdminChallengeRecord, tx?: Transaction): Promise<void>;

  /**
   * Atomic compare-and-set consume: `true` only for the ONE caller that
   * wins — the row exists, is not yet consumed, and has not expired as of
   * `now`. Every other caller (replay, unknown id, expired) gets `false`.
   */
  consume(challengeId: string, now: Instant, tx?: Transaction): Promise<boolean>;

  /**
   * Reads back a previously-appended challenge by its store key, so a
   * verifier can recover `challenge`/`adminOrganizationId` from the
   * `challengeId` the client sends. Returns `null` for an unknown id.
   */
  findById(challengeId: string): Promise<AdminChallengeEntry | null>;
}
