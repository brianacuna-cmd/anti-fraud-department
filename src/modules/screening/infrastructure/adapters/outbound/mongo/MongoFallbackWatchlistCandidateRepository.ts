import type { Collection, Db, Document, Filter } from 'mongodb';
import { ObjectId } from 'mongodb';
import type {
  WatchlistCandidate,
  WatchlistCandidateQuery,
  WatchlistCandidateRepository,
} from '../../../../domain/ports/WatchlistCandidateRepository.js';
import type { WatchlistEntryDocument } from './documents/WatchlistEntryDocument.js';
import { toCandidate } from './mappers/WatchlistEntryDocumentMapper.js';

const COLLECTION_NAME = 'watchlist_entries';

/**
 * Non-Atlas blocking adapter (design's "MongoIndexWatchlistCandidateRepository"
 * concept): a normal compound/text/regex query on `phonetic_keys` (array
 * membership) + `normalized_name` + exact `document`/`wallet_address`,
 * limit-bounded. Runs against a plain compound/regex index, so it is
 * fully compatible with `mongodb-memory-server` and is the adapter
 * exercised by CI (spec RF-2 scenario 2). Enforces org-tenant isolation
 * (RF-5) and excludes `status != "ACTIVE"` / soft-deleted entries at query
 * time, not post-hoc.
 *
 * Candidates come back RANKED: exact name / document / wallet first, then by
 * how many phonetic keys they share with the subject. The first version took
 * whatever `limit` entries matched ANY key, in storage order. With a small
 * internal list that was everything; against the official lists (~109k
 * names) a common word — "al", "muhammad" — matches thousands, and a literal
 * OFAC alias («Aiman Muhammad Rabi AL-ZAWAHIRI») never reached the scorer.
 */
export class MongoFallbackWatchlistCandidateRepository implements WatchlistCandidateRepository {
  private readonly collection: Collection<WatchlistEntryDocument>;

  constructor(db: Db) {
    this.collection = db.collection<WatchlistEntryDocument>(COLLECTION_NAME);
  }

  async findCandidates(query: WatchlistCandidateQuery): Promise<WatchlistCandidate[]> {
    const filter = buildFilter(query);
    // No blocking fields → nothing to block on. Return empty rather than
    // dumping every ACTIVE org entry, staying consistent with the Atlas adapter.
    if (filter === null) {
      return [];
    }
    const documents = await this.collection
      .aggregate<WatchlistEntryDocument>(rankedPipeline(filter, query), { allowDiskUse: true })
      .toArray();
    return documents.map(toCandidate);
  }
}

function exactClause(field: string, value: string | undefined): Document {
  return value ? { $eq: [`$${field}`, value] } : { $literal: false };
}

function rankedPipeline(filter: Filter<WatchlistEntryDocument>, query: WatchlistCandidateQuery): Document[] {
  return [
    { $match: filter },
    {
      $addFields: {
        _exact: {
          $cond: [
            {
              $or: [
                exactClause('normalized_name', query.normalizedName),
                exactClause('document', query.document),
                exactClause('wallet_address', query.walletAddress),
              ],
            },
            1,
            0,
          ],
        },
        _sharedKeys: {
          $size: { $setIntersection: [{ $ifNull: ['$phonetic_keys', []] }, [...(query.phoneticKeys ?? [])]] },
        },
      },
    },
    // `_id` last only to make ties deterministic.
    { $sort: { _exact: -1, _sharedKeys: -1, _id: 1 } },
    { $limit: query.limit },
    { $project: { _exact: 0, _sharedKeys: 0 } },
  ];
}

function buildFilter(query: WatchlistCandidateQuery): Filter<WatchlistEntryDocument> | null {
  const base: Filter<WatchlistEntryDocument> = {
    organization_id: new ObjectId(query.organizationId),
    entry_type: query.entryType,
    status: 'ACTIVE',
    deleted_at: null,
  };

  const blockingClauses: Filter<WatchlistEntryDocument>[] = [];
  if (query.document) {
    blockingClauses.push({ document: query.document });
  }
  if (query.walletAddress) {
    blockingClauses.push({ wallet_address: query.walletAddress });
  }
  if (query.phoneticKeys && query.phoneticKeys.length > 0) {
    blockingClauses.push({ phonetic_keys: { $in: [...query.phoneticKeys] } });
  }
  if (query.normalizedName) {
    blockingClauses.push({ normalized_name: query.normalizedName });
  }

  if (blockingClauses.length === 0) {
    return null;
  }

  return { ...base, $or: blockingClauses };
}
