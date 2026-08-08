import type {
  AdminChallengeEntry,
  AdminChallengeRecord,
  AdminChallengeStore,
} from '../../../src/modules/identity-access/domain/ports/AdminChallengeStore.js';
import type { Instant } from '../../../src/shared/time/Instant.js';

/**
 * In-memory `AdminChallengeStore` fake (design Testing Strategy: "in-memory
 * fakes for ports"), mirroring `InMemoryMfaChallengeStore`. `consume`'s CAS
 * semantics are reproduced exactly — `true` only for the FIRST caller to
 * observe an unconsumed, unexpired row.
 */
export class InMemoryAdminChallengeStore implements AdminChallengeStore {
  private readonly byChallengeId = new Map<string, AdminChallengeEntry>();

  async append(record: AdminChallengeRecord): Promise<void> {
    this.byChallengeId.set(record.challengeId, { ...record, consumedAt: null });
  }

  async consume(challengeId: string, now: Instant): Promise<boolean> {
    const record = this.byChallengeId.get(challengeId);
    if (!record || record.consumedAt !== null || record.expiresAt <= now) {
      return false;
    }
    this.byChallengeId.set(challengeId, { ...record, consumedAt: now });
    return true;
  }

  async findById(challengeId: string): Promise<AdminChallengeEntry | null> {
    return this.byChallengeId.get(challengeId) ?? null;
  }
}
