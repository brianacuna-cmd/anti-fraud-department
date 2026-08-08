import { InMemoryMfaChallengeStore } from '../../../helpers/identity-access/InMemoryMfaChallengeStore.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { MfaChallengeRecord } from '../../../../src/modules/identity-access/domain/ports/MfaChallengeStore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const EXPIRY = fromDate(new Date('2026-01-01T00:05:00.000Z'));
const PAST_EXPIRY = fromDate(new Date('2025-12-31T23:59:00.000Z'));

function buildRecord(overrides: Partial<MfaChallengeRecord> & { jti: string }): MfaChallengeRecord {
  return {
    jti: overrides.jti,
    userId: overrides.userId ?? 'user-1',
    organizationId: overrides.organizationId ?? 'org-1',
    actorType: 'USER',
    tokenType: overrides.tokenType ?? 'mfa_challenge',
    expiresAt: overrides.expiresAt ?? EXPIRY,
    now: overrides.now ?? NOW,
  };
}

describe('MfaChallengeStore (port contract, via InMemoryMfaChallengeStore fake)', () => {
  describe('consume', () => {
    it('returns true on the first call (CAS win)', async () => {
      const store = new InMemoryMfaChallengeStore();
      await store.append(buildRecord({ jti: 'jti-1' }));

      const won = await store.consume('jti-1', NOW);

      expect(won).toBe(true);
    });

    it('returns false on a second call for the same jti (CAS loser — replay)', async () => {
      const store = new InMemoryMfaChallengeStore();
      await store.append(buildRecord({ jti: 'jti-1' }));
      await store.consume('jti-1', NOW);

      const lost = await store.consume('jti-1', NOW);

      expect(lost).toBe(false);
    });

    it('returns false for an unknown jti', async () => {
      const store = new InMemoryMfaChallengeStore();

      expect(await store.consume('unknown-jti', NOW)).toBe(false);
    });

    it('returns false for an expired jti', async () => {
      const store = new InMemoryMfaChallengeStore();
      await store.append(buildRecord({ jti: 'jti-1', expiresAt: PAST_EXPIRY }));

      expect(await store.consume('jti-1', LATER)).toBe(false);
    });

    it('two concurrent consume calls on the same jti: exactly one wins', async () => {
      const store = new InMemoryMfaChallengeStore();
      await store.append(buildRecord({ jti: 'jti-1' }));

      const [first, second] = await Promise.all([store.consume('jti-1', NOW), store.consume('jti-1', NOW)]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });
  });

  describe('append', () => {
    it('persists distinct challenge and enrollment token types independently', async () => {
      const store = new InMemoryMfaChallengeStore();
      await store.append(buildRecord({ jti: 'jti-challenge', tokenType: 'mfa_challenge' }));
      await store.append(buildRecord({ jti: 'jti-enrollment', tokenType: 'mfa_enrollment' }));

      expect(await store.consume('jti-challenge', NOW)).toBe(true);
      expect(await store.consume('jti-enrollment', NOW)).toBe(true);
    });
  });
});
