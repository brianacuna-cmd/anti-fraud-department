import type { OrganizationId } from '../model/value-objects/OrganizationId.js';
import type { PasswordCredential } from '../model/value-objects/PasswordCredential.js';
import type { LockoutState } from '../model/value-objects/LockoutState.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * What `AuthenticateActor` needs to resolve a login attempt, regardless of
 * tier (design D19, D29). `organizationSlug` is REQUIRED by the User
 * adapter (`POST /auth/users/login` requires it — design D29) and IGNORED
 * by the Organization adapter, which has no tenant to scope by.
 */
export interface ActorCredentialLookup {
  readonly email: string;
  readonly organizationSlug?: string;
}

/**
 * A tier-agnostic view of whichever actor resolved (design D19) — never the
 * full `User`/`Organization` aggregate, so `AuthenticateActor` stays
 * ignorant of both aggregates' unrelated fields (identity, MFA, etc.).
 */
export interface ActorCredentialRecord {
  readonly actorId: string;
  readonly actorType: 'USER' | 'ORGANIZATION';
  /** The tenant a USER belongs to; `null` for an ORGANIZATION actor (it IS the tenant). */
  readonly organizationId: OrganizationId | null;
  readonly credential: PasswordCredential;
  readonly lockout: LockoutState;
  /** Raw `LifecycleStatus` (User) or `OrganizationStatus` (Organization) string — tier-specific gating stays in `AuthenticateActor`, not here. */
  readonly status: string;
}

/**
 * Tier-isolated actor lookup + lockout persistence (design D19) — ONE
 * `AuthenticateActor` service is parameterized by this port, with two
 * adapters (`UserActorGateway`, `OrganizationActorGateway`) so both tiers
 * share identical authentication/lockout rules while lookups never cross
 * tiers (no cross-tier email scan — design "Tier-Isolated Email Uniqueness
 * and Login Resolution").
 */
export interface ActorCredentialGateway {
  findByEmail(lookup: ActorCredentialLookup): Promise<ActorCredentialRecord | null>;

  /** Persists a failed-login `LockoutState` computed by `LockoutPolicy` against the resolved actor. */
  registerLoginFailure(
    actor: ActorCredentialRecord,
    lockout: LockoutState,
    now: Instant,
    tx?: Transaction,
  ): Promise<void>;

  /** Persists the reset-to-zero `LockoutState` a successful login always produces. */
  registerLoginSuccess(actor: ActorCredentialRecord, now: Instant, tx?: Transaction): Promise<void>;
}
