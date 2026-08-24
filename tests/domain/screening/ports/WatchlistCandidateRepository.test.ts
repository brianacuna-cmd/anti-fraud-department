import type { WatchlistCandidate, WatchlistCandidateRepository } from '../../../../src/modules/screening/domain/ports/WatchlistCandidateRepository.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { oid } from '../../../support/oid.js';

/** In-memory fake proving the port shape ahead of the Mongo adapters. */
class InMemoryWatchlistCandidateRepository implements WatchlistCandidateRepository {
  constructor(private readonly candidates: readonly WatchlistCandidate[]) {}

  async findCandidates(query: {
    organizationId: string;
    normalizedName?: string;
    phoneticKeys?: readonly string[];
    documento?: string;
    walletAddress?: string;
    entryType: 'PERSON' | 'ORGANIZATION' | 'WALLET';
    limit: number;
  }): Promise<WatchlistCandidate[]> {
    return this.candidates
      .filter((candidate) => candidate.pais !== undefined || true)
      .slice(0, query.limit);
  }
}

function buildCandidate(overrides: Partial<WatchlistCandidate> = {}): WatchlistCandidate {
  return {
    id: createWatchlistEntryId(oid('entry-1')),
    watchlistId: createWatchlistId(oid('watchlist-1')),
    nombre: 'John Smith',
    documento: '123456789',
    walletAddress: null,
    nivelRiesgo: 'HIGH',
    nombreNormalizado: 'john smith',
    phoneticKeys: ['JN', 'SM0'],
    pais: 'US',
    ...overrides,
  };
}

describe('WatchlistCandidateRepository (port contract shape)', () => {
  it('findCandidates returns bounded domain candidate records, never Mongo cursors', async () => {
    const repository = new InMemoryWatchlistCandidateRepository([buildCandidate(), buildCandidate({ nombre: 'Jane Doe' })]);

    const candidates = await repository.findCandidates({
      organizationId: oid('org-1'),
      normalizedName: 'john smith',
      phoneticKeys: ['JN'],
      entryType: 'PERSON',
      limit: 1,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.nombre).toBe('John Smith');
    expect(candidates[0]?.watchlistId).toBe(createWatchlistId(oid('watchlist-1')));
  });
});
