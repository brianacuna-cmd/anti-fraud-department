import { Session } from '../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import type { SessionActorRef, SessionRepository } from '../../../src/modules/identity-access/domain/ports/SessionRepository.js';
import type { SessionId } from '../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import type { FamilyId } from '../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import type { OrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import type { Instant } from '../../../src/shared/time/Instant.js';

/**
 * In-memory `SessionRepository` fake (design Testing Strategy: "in-memory
 * fakes for ports"). `markRotated`'s CAS semantics are reproduced exactly —
 * `true` only for the FIRST caller to observe `rotatedAt: null` — so
 * application-layer unit tests can exercise the same race-loser/grace-branch
 * logic the real Mongo adapter guarantees (design D15).
 */
export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.byId.set(session.id, session);
  }

  async findByTokenHash(hash: string): Promise<Session | null> {
    for (const session of this.byId.values()) {
      if (session.tokenHash === hash) {
        return session;
      }
    }
    return null;
  }

  async findByRefreshTokenHash(hash: string): Promise<Session | null> {
    for (const session of this.byId.values()) {
      if (session.refreshTokenHash === hash) {
        return session;
      }
    }
    return null;
  }

  async markRotated(id: SessionId, rotatedAt: Instant): Promise<boolean> {
    const session = this.byId.get(id);
    if (!session || session.rotatedAt !== null) {
      return false;
    }
    this.byId.set(
      id,
      Session.rehydrate({ ...session.toProps(), rotatedAt, updatedAt: rotatedAt }),
    );
    return true;
  }

  async revokeFamily(familyId: FamilyId, revokedAt: Instant): Promise<number> {
    return this.revokeMatching((session) => session.familyId === familyId, revokedAt);
  }

  async revokeAllForOrganization(id: OrganizationId, at: Instant): Promise<number> {
    return this.revokeMatching((session) => session.organizationId === id, at);
  }

  async revokeAllForActor(actor: SessionActorRef, at: Instant): Promise<number> {
    return this.revokeMatching(
      (session) =>
        actor.actorType === 'ORGANIZATION'
          ? session.actorType === 'ORGANIZATION' && session.organizationId === actor.organizationId
          : session.actorType === actor.actorType && session.userId === actor.userId,
      at,
    );
  }

  private revokeMatching(predicate: (session: Session) => boolean, at: Instant): number {
    let count = 0;
    for (const [id, session] of this.byId) {
      if (predicate(session) && session.deletedAt === null) {
        this.byId.set(id, Session.rehydrate({ ...session.toProps(), deletedAt: at, updatedAt: at }));
        count += 1;
      }
    }
    return count;
  }
}
