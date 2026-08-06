import type { Session } from '../model/aggregates/Session.js';
import type { SessionId } from '../model/value-objects/SessionId.js';
import type { FamilyId } from '../model/value-objects/FamilyId.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Identifies the principal whose sessions `revokeAllForActor` must revoke
 * (design D28). `USER`/`PLATFORM_ADMIN` key on `userId` — design D14:
 * `Sessions.UserId` holds the principal's `_id` for BOTH tiers. `ORGANIZATION`
 * keys on `organizationId` instead — an Organization actor's own sessions
 * carry a `null` `UserId`.
 */
export type SessionActorRef =
  | { readonly actorType: 'USER'; readonly userId: string }
  | { readonly actorType: 'PLATFORM_ADMIN'; readonly userId: string }
  | { readonly actorType: 'ORGANIZATION'; readonly organizationId: OrganizationId };

/**
 * Outbound port for the `Session` aggregate (design D14, D15, D27, D28,
 * D38). Not tenant-bound like `UserRepository` — a session lookup by token
 * hash has no tenant to scope by until AFTER the row resolves.
 */
export interface SessionRepository {
  save(session: Session, tx?: Transaction): Promise<void>;

  findByTokenHash(hash: string): Promise<Session | null>;

  /** Implies `$exists`+`$type:'string'`, so it qualifies for the D38 partial index. */
  findByRefreshTokenHash(hash: string, tx?: Transaction): Promise<Session | null>;

  /**
   * Atomic compare-and-set (design D15) — matches only a row whose
   * `RotatedAt` is still unset. Returns `true` for the ONE caller that wins
   * the race; every other concurrent caller gets `false` and must re-read
   * committed state to decide the grace/theft branch.
   */
  markRotated(id: SessionId, rotatedAt: Instant, tx?: Transaction): Promise<boolean>;

  /** Unsessioned by design (D16) — reuse-detection revocation must survive the failing request's own rollback. */
  revokeFamily(familyId: FamilyId, revokedAt: Instant): Promise<number>;

  /** Sets `deletedAt` on exactly the given session (Phase 4 — `Logout`). A no-op for an unknown or already-revoked id. */
  revokeSession(id: SessionId, revokedAt: Instant, tx?: Transaction): Promise<void>;

  revokeAllForOrganization(id: OrganizationId, at: Instant, tx?: Transaction): Promise<number>;

  revokeAllForActor(actor: SessionActorRef, at: Instant, tx?: Transaction): Promise<number>;
}
