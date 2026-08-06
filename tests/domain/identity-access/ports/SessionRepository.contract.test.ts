import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { Session } from '../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

function buildSession(overrides: {
  id: string;
  familyId?: string;
  userId?: string | null;
  organizationId?: string | null;
  actorType?: 'USER' | 'ORGANIZATION' | 'PLATFORM_ADMIN';
  refreshTokenHash?: string | null;
}): Session {
  return Session.create({
    id: createSessionId(overrides.id),
    userId: overrides.userId ?? 'user-1',
    organizationId: overrides.organizationId === null ? null : createOrganizationId(overrides.organizationId ?? 'org-1'),
    actorType: overrides.actorType ?? 'USER',
    tokenHash: `token-hash-${overrides.id}`,
    refreshTokenHash: overrides.refreshTokenHash === undefined ? `refresh-hash-${overrides.id}` : overrides.refreshTokenHash,
    expiresAt: NOW,
    refreshExpiresAt: LATER,
    familyId: createFamilyId(overrides.familyId ?? 'family-1'),
    familyExpiresAt: LATER,
    now: NOW,
  });
}

describe('SessionRepository (port contract, via InMemorySessionRepository fake)', () => {
  it('persists and retrieves a session by tokenHash', async () => {
    const repository = new InMemorySessionRepository();
    await repository.save(buildSession({ id: 'session-1' }));

    const found = await repository.findByTokenHash('token-hash-session-1');

    expect(found?.id).toBe('session-1');
  });

  it('returns null from findByTokenHash when no session matches', async () => {
    const repository = new InMemorySessionRepository();

    expect(await repository.findByTokenHash('missing')).toBeNull();
  });

  it('retrieves a session by refreshTokenHash', async () => {
    const repository = new InMemorySessionRepository();
    await repository.save(buildSession({ id: 'session-1' }));

    const found = await repository.findByRefreshTokenHash('refresh-hash-session-1');

    expect(found?.id).toBe('session-1');
  });

  describe('markRotated', () => {
    it('returns true on the first call (CAS win) and stamps rotatedAt', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: 'session-1' }));

      const won = await repository.markRotated(createSessionId('session-1'), LATER);

      expect(won).toBe(true);
      const found = await repository.findByTokenHash('token-hash-session-1');
      expect(found?.rotatedAt).toBe(LATER);
    });

    it('returns false on a second call for the same session (CAS loser)', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: 'session-1' }));
      await repository.markRotated(createSessionId('session-1'), LATER);

      const lost = await repository.markRotated(createSessionId('session-1'), LATER);

      expect(lost).toBe(false);
    });

    it('returns false for an unknown session id', async () => {
      const repository = new InMemorySessionRepository();

      expect(await repository.markRotated(createSessionId('missing'), LATER)).toBe(false);
    });
  });

  describe('revokeFamily', () => {
    it('revokes every session sharing the familyId and returns the count', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: 'session-1', familyId: 'family-1' }));
      await repository.save(buildSession({ id: 'session-2', familyId: 'family-1' }));
      await repository.save(buildSession({ id: 'session-3', familyId: 'family-2' }));

      const count = await repository.revokeFamily(createFamilyId('family-1'), LATER);

      expect(count).toBe(2);
      expect((await repository.findByTokenHash('token-hash-session-1'))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash('token-hash-session-2'))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash('token-hash-session-3'))?.deletedAt).toBeNull();
    });

    it('is idempotent — a second call revokes nothing further', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: 'session-1', familyId: 'family-1' }));
      await repository.revokeFamily(createFamilyId('family-1'), NOW);

      const secondCount = await repository.revokeFamily(createFamilyId('family-1'), LATER);

      expect(secondCount).toBe(0);
    });
  });

  describe('revokeAllForOrganization', () => {
    it('revokes only sessions belonging to that organization', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: 'session-1', organizationId: 'org-1' }));
      await repository.save(buildSession({ id: 'session-2', organizationId: 'org-2' }));

      const count = await repository.revokeAllForOrganization(createOrganizationId('org-1'), LATER);

      expect(count).toBe(1);
      expect((await repository.findByTokenHash('token-hash-session-1'))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash('token-hash-session-2'))?.deletedAt).toBeNull();
    });
  });

  describe('revokeAllForActor', () => {
    it('revokes every session for a USER actor by userId', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: 'session-1', userId: 'user-1', actorType: 'USER' }));
      await repository.save(buildSession({ id: 'session-2', userId: 'user-2', actorType: 'USER' }));

      const count = await repository.revokeAllForActor({ actorType: 'USER', userId: 'user-1' }, LATER);

      expect(count).toBe(1);
      expect((await repository.findByTokenHash('token-hash-session-1'))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash('token-hash-session-2'))?.deletedAt).toBeNull();
    });

    it('revokes every session for an ORGANIZATION actor by organizationId', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(
        buildSession({ id: 'session-1', userId: null, organizationId: 'org-1', actorType: 'ORGANIZATION' }),
      );
      await repository.save(
        buildSession({ id: 'session-2', userId: null, organizationId: 'org-2', actorType: 'ORGANIZATION' }),
      );

      const count = await repository.revokeAllForActor({ actorType: 'ORGANIZATION', organizationId: createOrganizationId('org-1') }, LATER);

      expect(count).toBe(1);
      expect((await repository.findByTokenHash('token-hash-session-1'))?.deletedAt).toBe(LATER);
      expect((await repository.findByTokenHash('token-hash-session-2'))?.deletedAt).toBeNull();
    });
  });
});
