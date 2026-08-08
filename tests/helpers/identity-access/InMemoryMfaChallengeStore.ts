import type {
  MfaChallengeRecord,
  MfaChallengeStore,
} from '../../../src/modules/identity-access/domain/ports/MfaChallengeStore.js';
import type { Instant } from '../../../src/shared/time/Instant.js';

interface StoredChallenge extends MfaChallengeRecord {
  consumedAt: Instant | null;
}

/**
 * In-memory `MfaChallengeStore` fake (design Testing Strategy: "in-memory
 * fakes for ports"). `consume`'s CAS semantics are reproduced exactly —
 * `true` only for the FIRST caller to observe an unconsumed, unexpired row —
 * mirroring `InMemorySessionRepository.markRotated`'s identical contract.
 */
export class InMemoryMfaChallengeStore implements MfaChallengeStore {
  private readonly byJti = new Map<string, StoredChallenge>();

  async append(record: MfaChallengeRecord): Promise<void> {
    this.byJti.set(record.jti, { ...record, consumedAt: null });
  }

  async consume(jti: string, now: Instant): Promise<boolean> {
    const record = this.byJti.get(jti);
    if (!record || record.consumedAt !== null || record.expiresAt <= now) {
      return false;
    }
    this.byJti.set(jti, { ...record, consumedAt: now });
    return true;
  }

  /** Test-only introspection helper. */
  get(jti: string): StoredChallenge | undefined {
    return this.byJti.get(jti);
  }
}
