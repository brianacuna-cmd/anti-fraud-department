import type {
  ActorCredentialGateway,
  ActorCredentialLookup,
  ActorCredentialRecord,
} from '../../../../domain/ports/ActorCredentialGateway.js';
import type { OrganizationRepository } from '../../../../domain/ports/OrganizationRepository.js';
import type { UserRepositoryFactory } from '../../../../domain/ports/UserRepositoryFactory.js';
import type { LockoutState } from '../../../../domain/model/value-objects/LockoutState.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { createSlug } from '../../../../domain/model/value-objects/Slug.js';
import { createEmail } from '../../../../domain/model/value-objects/Email.js';
import { createUserId } from '../../../../domain/model/value-objects/UserId.js';
import { IdentityAccessError } from '../../../../domain/errors/IdentityAccessError.js';
import type { User } from '../../../../domain/model/aggregates/User.js';

function toRecord(user: User): ActorCredentialRecord {
  return {
    actorId: user.id,
    actorType: 'USER',
    organizationId: user.organizationId,
    credential: user.credential,
    lockout: user.lockout,
    status: user.status,
    mfa: { enabled: user.mfa.enabled, secret: user.mfa.secret },
  };
}

/**
 * `ActorCredentialGateway` adapter for the Users tier (design D19, D29).
 * `findByEmail` REQUIRES `organizationSlug` — a User lookup with none is
 * treated exactly like an unresolved account (`null`), the SAME path
 * `AuthenticateActor` takes for an unknown email, so the caller-controlled
 * absence of a slug carries no distinguishable timing/response signal.
 * A malformed slug or email (VO guard failure) is likewise swallowed to
 * `null` rather than surfaced as `INVARIANT_VIOLATION` — a login attempt is
 * transport input, not a trusted internal caller.
 */
export class UserActorGateway implements ActorCredentialGateway {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly userRepositoryFactory: UserRepositoryFactory,
  ) {}

  async findByEmail(lookup: ActorCredentialLookup): Promise<ActorCredentialRecord | null> {
    if (!lookup.organizationSlug) {
      return null;
    }
    try {
      const slug = createSlug(lookup.organizationSlug);
      const organization = await this.organizations.findBySlug(slug);
      if (!organization) {
        return null;
      }
      const email = createEmail(lookup.email);
      const user = await this.userRepositoryFactory.forTenant(organization.id).findByEmail(email);
      return user ? toRecord(user) : null;
    } catch (error) {
      if (error instanceof IdentityAccessError && error.code === 'INVARIANT_VIOLATION') {
        return null;
      }
      throw error;
    }
  }

  async registerLoginFailure(
    actor: ActorCredentialRecord,
    lockout: LockoutState,
    now: Instant,
    tx?: Transaction,
  ): Promise<void> {
    await this.writeLockout(actor, lockout, now, tx);
  }

  async registerLoginSuccess(actor: ActorCredentialRecord, now: Instant, tx?: Transaction): Promise<void> {
    await this.writeLockout(actor, { loginAttempts: 0, blockedUntil: null }, now, tx);
  }

  private async writeLockout(
    actor: ActorCredentialRecord,
    lockout: LockoutState,
    now: Instant,
    tx?: Transaction,
  ): Promise<void> {
    if (actor.organizationId === null) {
      throw new Error('UserActorGateway received an actor with no organizationId — wiring bug');
    }
    const repository = this.userRepositoryFactory.forTenant(actor.organizationId);
    const user = await repository.findById(createUserId(actor.actorId));
    if (!user) {
      return;
    }
    await repository.save(user.withLockout(lockout, now), tx);
  }
}
