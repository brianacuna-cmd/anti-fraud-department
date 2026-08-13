import type { Session } from '../model/aggregates/Session.js';
import type { SessionId } from '../model/value-objects/SessionId.js';
import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Identifies the principal whose sessions `revokeAllForActor` must revoke.
 * USER keys on `user_id`, ORGANIZATION on `organization_id` (org-tier rows
 * only — `user_id` null), PLATFORM_ADMIN on `admin_organization_id`.
 */
export type SessionActorRef =
  | { readonly actorType: 'USER'; readonly userId: string }
  | { readonly actorType: 'PLATFORM_ADMIN'; readonly adminOrganizationId: string }
  | { readonly actorType: 'ORGANIZATION'; readonly organizationId: OrganizationId };

/**
 * Outbound port for the `Session` aggregate. Not tenant-bound — a lookup by
 * token hash has no tenant to scope by until AFTER the row resolves.
 */
export interface SessionRepository {
  save(session: Session, tx?: Transaction): Promise<void>;

  findById(id: SessionId, tx?: Transaction): Promise<Session | null>;

  findByTokenHash(hash: string): Promise<Session | null>;

  /** Sets `deletedAt` on exactly the given session (`Logout`). A no-op for an unknown or already-revoked id. */
  revokeSession(id: SessionId, revokedAt: Instant, tx?: Transaction): Promise<void>;

  revokeAllForOrganization(id: OrganizationId, at: Instant, tx?: Transaction): Promise<number>;

  revokeAllForActor(actor: SessionActorRef, at: Instant, tx?: Transaction): Promise<number>;
}
