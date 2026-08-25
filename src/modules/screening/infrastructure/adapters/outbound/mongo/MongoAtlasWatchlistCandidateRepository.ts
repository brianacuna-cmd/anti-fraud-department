import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type {
  WatchlistCandidate,
  WatchlistCandidateQuery,
  WatchlistCandidateRepository,
} from '../../../../domain/ports/WatchlistCandidateRepository.js';
import type { WatchlistEntryDocument } from './documents/WatchlistEntryDocument.js';
import { toCandidate } from './mappers/WatchlistEntryDocumentMapper.js';

const COLLECTION_NAME = 'watchlist_entries';
const ATLAS_SEARCH_INDEX = 'watchlist_entries_search';
const FUZZY_MAX_EDITS = 2;

/**
 * STAGING-ONLY / PROD adapter (design's "KEY DECISION — Atlas Search
 * testability"): uses MongoDB Atlas Search `$search` compound (phonetic
 * `terms` + text `fuzzy` maxEdits) + `$limit`. Atlas Search has NO
 * `mongodb-memory-server` equivalent, so this adapter is NEVER exercised
 * by the CI suite — it is covered only by a pipeline-shape unit test
 * (`tests/infrastructure/screening/MongoAtlasWatchlistCandidateRepository.test.ts`,
 * a mocked-collection assertion, not a live `$search` call) and by manual
 * staging verification against a real Atlas cluster. It MUST NOT gate the
 * fallback adapter's (`MongoFallbackWatchlistCandidateRepository`) green
 * suite. DI selection between this adapter and the fallback lands in
 * Slice 7 via `SCREENING_MATCH_BACKEND=atlas|index`.
 */
export class MongoAtlasWatchlistCandidateRepository implements WatchlistCandidateRepository {
  constructor(private readonly db: Db) {}

  async findCandidates(query: WatchlistCandidateQuery): Promise<WatchlistCandidate[]> {
    const pipeline = buildPipeline(query);
    // No blocking fields → nothing to search on. Return empty to stay
    // consistent with the fallback adapter (an empty `compound.should` with
    // `minimumShouldMatch: 1` would be invalid/match nothing on Atlas anyway).
    if (pipeline === null) {
      return [];
    }
    const collection = this.db.collection<WatchlistEntryDocument>(COLLECTION_NAME);
    const documents = (await collection.aggregate(pipeline).toArray()) as WatchlistEntryDocument[];
    return documents.map(toCandidate);
  }
}

function buildPipeline(query: WatchlistCandidateQuery): Record<string, unknown>[] | null {
  const should: Record<string, unknown>[] = [];

  if (query.phoneticKeys && query.phoneticKeys.length > 0) {
    should.push({
      text: {
        query: [...query.phoneticKeys],
        path: 'phonetic_keys',
      },
    });
  }

  if (query.normalizedName) {
    should.push({
      text: {
        query: query.normalizedName,
        path: 'normalized_name',
        fuzzy: { maxEdits: FUZZY_MAX_EDITS },
      },
    });
  }

  if (query.document) {
    should.push({ text: { query: query.document, path: 'document' } });
  }

  if (query.walletAddress) {
    should.push({ text: { query: query.walletAddress, path: 'wallet_address' } });
  }

  if (should.length === 0) {
    return null;
  }

  return [
    {
      $search: {
        index: ATLAS_SEARCH_INDEX,
        compound: { should, minimumShouldMatch: 1 },
      },
    },
    {
      $match: {
        organization_id: new ObjectId(query.organizationId),
        entry_type: query.entryType,
        status: 'ACTIVE',
        deleted_at: null,
      },
    },
    { $limit: query.limit },
  ];
}
