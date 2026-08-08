import { InMemoryAdminChallengeStore } from '../../../helpers/identity-access/InMemoryAdminChallengeStore.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { AdminChallengeRecord } from '../../../../src/modules/identity-access/domain/ports/AdminChallengeStore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const EXPIRY = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const PAST_EXPIRY = fromDate(new Date('2025-12-31T23:59:00.000Z'));

function buildRecord(overrides: Partial<AdminChallengeRecord> & { challengeId: string }): AdminChallengeRecord {
  return {
    challengeId: overrides.challengeId,
    adminOrganizationId: overrides.adminOrganizationId ?? 'admin-org-1',
    challenge: overrides.challenge ?? 'challenge-secret-1',
    expiresAt: overrides.expiresAt ?? EXPIRY,
    now: overrides.now ?? NOW,
  };
}

describe('AdminChallengeStore (port contract, via InMemoryAdminChallengeStore fake)', () => {
  describe('consume', () => {
    it('returns true on the first call (CAS win)', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1' }));

      const won = await store.consume('challenge-id-1', NOW);

      expect(won).toBe(true);
    });

    it('returns false on a second call for the same challengeId (CAS loser — replay)', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1' }));
      await store.consume('challenge-id-1', NOW);

      const lost = await store.consume('challenge-id-1', NOW);

      expect(lost).toBe(false);
    });

    it('returns false for an unknown challengeId', async () => {
      const store = new InMemoryAdminChallengeStore();

      expect(await store.consume('unknown-challenge-id', NOW)).toBe(false);
    });

    it('returns false for an expired challengeId', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1', expiresAt: PAST_EXPIRY }));

      expect(await store.consume('challenge-id-1', LATER)).toBe(false);
    });

    it('two concurrent consume calls on the same challengeId: exactly one wins', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1' }));

      const [first, second] = await Promise.all([
        store.consume('challenge-id-1', NOW),
        store.consume('challenge-id-1', NOW),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('returns the appended record with consumedAt null', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1', challenge: 'super-secret' }));

      const entry = await store.findById('challenge-id-1');

      expect(entry).toMatchObject({
        challengeId: 'challenge-id-1',
        adminOrganizationId: 'admin-org-1',
        challenge: 'super-secret',
        consumedAt: null,
      });
    });

    it('reflects consumedAt after a successful consume', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1' }));
      await store.consume('challenge-id-1', NOW);

      const entry = await store.findById('challenge-id-1');

      expect(entry?.consumedAt).toBe(NOW);
    });

    it('returns null for an unknown challengeId', async () => {
      const store = new InMemoryAdminChallengeStore();

      expect(await store.findById('unknown-challenge-id')).toBeNull();
    });
  });

  describe('append', () => {
    it('keeps the challenge secret separate from the store key (challengeId)', async () => {
      const store = new InMemoryAdminChallengeStore();
      await store.append(buildRecord({ challengeId: 'challenge-id-1', challenge: 'a-different-secret-value' }));

      const entry = await store.findById('challenge-id-1');

      expect(entry?.challengeId).not.toBe(entry?.challenge);
    });
  });
});
