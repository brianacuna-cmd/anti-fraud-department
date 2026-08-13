import { Session } from '../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import type { SessionActorRef, SessionRepository } from '../../../src/modules/identity-access/domain/ports/SessionRepository.js';
import type { SessionId } from '../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import type { OrganizationId } from '../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import type { Instant } from '../../../src/shared/time/Instant.js';

export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.byId.set(session.id, session);
  }

  async findById(id: SessionId): Promise<Session | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTokenHash(hash: string): Promise<Session | null> {
    for (const session of this.byId.values()) {
      if (session.tokenHash === hash) {
        return session;
      }
    }
    return null;
  }

  async revokeSession(id: SessionId, revokedAt: Instant): Promise<void> {
    this.revokeMatching((session) => session.id === id, revokedAt);
  }

  async revokeAllForOrganization(id: OrganizationId, at: Instant): Promise<number> {
    return this.revokeMatching((session) => session.organizationId === id, at);
  }

  async revokeAllForActor(actor: SessionActorRef, at: Instant): Promise<number> {
    return this.revokeMatching((session) => {
      if (actor.actorType === 'ORGANIZATION') {
        return session.organizationId === actor.organizationId && session.userId === null;
      }
      if (actor.actorType === 'PLATFORM_ADMIN') {
        return session.adminOrganizationId === actor.adminOrganizationId;
      }
      return session.userId === actor.userId;
    }, at);
  }

  private revokeMatching(predicate: (session: Session) => boolean, at: Instant): number {
    let count = 0;
    for (const [id, session] of this.byId) {
      if (predicate(session) && session.deletedAt === null) {
        this.byId.set(id, Session.rehydrate({ ...session.toProps(), deletedAt: at }));
        count += 1;
      }
    }
    return count;
  }
}
