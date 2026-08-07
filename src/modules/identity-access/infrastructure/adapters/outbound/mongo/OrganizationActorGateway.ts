import type {
  ActorCredentialGateway,
  ActorCredentialLookup,
  ActorCredentialRecord,
} from '../../../../domain/ports/ActorCredentialGateway.js';
import type { OrganizationRepository } from '../../../../domain/ports/OrganizationRepository.js';
import type { LockoutState } from '../../../../domain/model/value-objects/LockoutState.js';
import type { Instant } from '../../../../../../shared/time/Instant.js';
import type { Transaction } from '../../../../domain/ports/UnitOfWork.js';
import { createEmail } from '../../../../domain/model/value-objects/Email.js';
import { createOrganizationId } from '../../../../domain/model/value-objects/OrganizationId.js';
import { IdentityAccessError } from '../../../../domain/errors/IdentityAccessError.js';
import type { Organization } from '../../../../domain/model/aggregates/Organization.js';

/**
 * `credential` is only non-null when an `Organization` actually has one
 * (design D36, pulled forward — most rows are still credential-less until
 * Phase 7's bootstrap flow sets them). Callers MUST have already filtered
 * out a `null` credential before constructing this record — `toRecord`
 * below is the one place that does so.
 */
function toRecord(organization: Organization): ActorCredentialRecord | null {
  if (organization.credential === null) {
    return null;
  }
  return {
    actorId: organization.id,
    actorType: 'ORGANIZATION',
    organizationId: null,
    credential: organization.credential,
    lockout: organization.lockout,
    status: organization.status,
  };
}

/**
 * `ActorCredentialGateway` adapter for the Organizations tier (design D19).
 * `organizationSlug` is IGNORED — an Organization has no tenant to scope by,
 * it IS the tenant. Never matches a credential-less row (design D36 pulled
 * forward): an organization with no `email`/`credential` set yet reads
 * identically to an unknown email.
 */
export class OrganizationActorGateway implements ActorCredentialGateway {
  constructor(private readonly organizations: OrganizationRepository) {}

  async findByEmail(lookup: ActorCredentialLookup): Promise<ActorCredentialRecord | null> {
    try {
      const email = createEmail(lookup.email);
      const organization = await this.organizations.findByEmail(email);
      return organization ? toRecord(organization) : null;
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
    const organization = await this.organizations.findById(createOrganizationId(actor.actorId));
    if (!organization) {
      return;
    }
    await this.organizations.save(organization.withLockout(lockout, now), tx);
  }
}
