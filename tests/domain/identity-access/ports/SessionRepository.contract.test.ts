import { oid } from '../../../support/oid.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { buildSession } from '../../../helpers/identity-access/buildSession.js';
import { createSessionId } from '../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

describe('SessionRepository (port contract, via InMemorySessionRepository fake)', () => {
  it('persists and retrieves a session by tokenHash', async () => {
    const repository = new InMemorySessionRepository();
    const session = buildSession({ id: oid('session-1') });
    await repository.save(session);

    const found = await repository.findByTokenHash(session.tokenHash);

    expect(found?.id).toBe(oid('session-1'));
  });

  it('returns null from findByTokenHash when no session matches', async () => {
    const repository = new InMemorySessionRepository();

    expect(await repository.findByTokenHash('missing')).toBeNull();
  });

  it('retrieves a session by id', async () => {
    const repository = new InMemorySessionRepository();
    await repository.save(buildSession({ id: oid('session-1') }));

    const found = await repository.findById(createSessionId(oid('session-1')));

    expect(found?.id).toBe(oid('session-1'));
  });

  describe('revokeAllForOrganization', () => {
    it('revokes only sessions belonging to that organization', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: oid('session-1'), organizationId: oid('org-1') }));
      await repository.save(buildSession({ id: oid('session-2'), organizationId: oid('org-2') }));

      const count = await repository.revokeAllForOrganization(createOrganizationId(oid('org-1')), LATER);

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('sets deletedAt on exactly the given session id', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: oid('session-1') }));
      await repository.save(buildSession({ id: oid('session-2') }));

      await repository.revokeSession(createSessionId(oid('session-1')), LATER);

      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });

    it('is a no-op for an unknown session id', async () => {
      const repository = new InMemorySessionRepository();

      await expect(repository.revokeSession(createSessionId(oid('missing')), LATER)).resolves.toBeUndefined();
    });

    it('is idempotent for an already-revoked session', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: oid('session-1') }));
      await repository.revokeSession(createSessionId(oid('session-1')), fromDate(new Date('2026-01-01T00:00:00.000Z')));

      await expect(repository.revokeSession(createSessionId(oid('session-1')), LATER)).resolves.toBeUndefined();
    });
  });

  describe('revokeAllForActor', () => {
    it('revokes every session for a USER actor by userId', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: oid('session-1'), userId: oid('user-1') }));
      await repository.save(buildSession({ id: oid('session-2'), userId: oid('user-2') }));

      const count = await repository.revokeAllForActor({ actorType: 'USER', userId: oid('user-1') }, LATER);

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });

    it('revokes every session for an ORGANIZATION actor by organizationId (org-tier rows only)', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: oid('session-1'), userId: null, organizationId: oid('org-1') }));
      await repository.save(buildSession({ id: oid('session-2'), userId: null, organizationId: oid('org-2') }));

      const count = await repository.revokeAllForActor(
        { actorType: 'ORGANIZATION', organizationId: createOrganizationId(oid('org-1')) },
        LATER,
      );

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });

    it('revokes every session for a PLATFORM_ADMIN actor by adminOrganizationId', async () => {
      const repository = new InMemorySessionRepository();
      await repository.save(buildSession({ id: oid('session-1'), adminOrganizationId: oid('admin-1') }));
      await repository.save(buildSession({ id: oid('session-2'), adminOrganizationId: oid('admin-2') }));

      const count = await repository.revokeAllForActor(
        { actorType: 'PLATFORM_ADMIN', adminOrganizationId: oid('admin-1') },
        LATER,
      );

      expect(count).toBe(1);
      expect((await repository.findById(createSessionId(oid('session-1'))))?.deletedAt).toBe(LATER);
      expect((await repository.findById(createSessionId(oid('session-2'))))?.deletedAt).toBeNull();
    });
  });
});
