import type {
  ActorCredentialGateway,
  ActorCredentialLookup,
  ActorCredentialRecord,
} from '../../../src/modules/identity-access/domain/ports/ActorCredentialGateway.js';
import type { LockoutState } from '../../../src/modules/identity-access/domain/model/value-objects/LockoutState.js';
import type { Instant } from '../../../src/shared/time/Instant.js';

/**
 * In-memory `ActorCredentialGateway` fake (design Testing Strategy:
 * "in-memory fakes for ports") — used by both tier's unit tests since the
 * port is tier-agnostic (design D19). `organizationSlug` is honored only
 * when a record's `requiresSlug` was registered, mirroring
 * `UserActorGateway`'s real requirement without needing a real
 * `OrganizationRepository`.
 */
export class InMemoryActorCredentialGateway implements ActorCredentialGateway {
  private readonly byEmail = new Map<string, { record: ActorCredentialRecord; requiresSlug: string | null }>();
  registeredFailures: Array<{ actorId: string; lockout: LockoutState }> = [];
  registeredSuccesses: string[] = [];

  seed(email: string, record: ActorCredentialRecord, requiresSlug: string | null = null): void {
    this.byEmail.set(email, { record, requiresSlug });
  }

  async findByEmail(lookup: ActorCredentialLookup): Promise<ActorCredentialRecord | null> {
    const entry = this.byEmail.get(lookup.email);
    if (!entry) {
      return null;
    }
    if (entry.requiresSlug !== null && entry.requiresSlug !== lookup.organizationSlug) {
      return null;
    }
    return entry.record;
  }

  async registerLoginFailure(actor: ActorCredentialRecord, lockout: LockoutState, now: Instant): Promise<void> {
    this.registeredFailures.push({ actorId: actor.actorId, lockout });
    this.updateStoredLockout(actor.actorId, lockout);
  }

  async registerLoginSuccess(actor: ActorCredentialRecord, now: Instant): Promise<void> {
    this.registeredSuccesses.push(actor.actorId);
    this.updateStoredLockout(actor.actorId, { loginAttempts: 0, blockedUntil: null });
  }

  private updateStoredLockout(actorId: string, lockout: LockoutState): void {
    for (const [email, entry] of this.byEmail) {
      if (entry.record.actorId === actorId) {
        this.byEmail.set(email, { ...entry, record: { ...entry.record, lockout } });
      }
    }
  }
}
