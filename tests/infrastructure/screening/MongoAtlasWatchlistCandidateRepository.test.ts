import { ObjectId } from 'mongodb';
import { MongoAtlasWatchlistCandidateRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAtlasWatchlistCandidateRepository.js';
import { oid } from '../../support/oid.js';

/**
 * STAGING-ONLY, CI-UNCOVERED: `$search` (Atlas Search) has no
 * `mongodb-memory-server` equivalent, so this adapter cannot be
 * integration-tested in CI. This unit test only asserts the aggregation
 * pipeline SHAPE passed to `aggregate()` via a mock collection — it never
 * exercises real Atlas Search behavior. See design's "KEY DECISION — Atlas
 * Search testability" and tasks Slice 4 Task 4.3.
 */
describe('MongoAtlasWatchlistCandidateRepository (unit, pipeline shape only — staging-only adapter)', () => {
  it('builds a $search compound pipeline with phonetic terms + fuzzy text + $limit, scoped to org/estado/tipo', async () => {
    const toArray = jest.fn().mockResolvedValue([]);
    const aggregate = jest.fn().mockReturnValue({ toArray });
    const collection = jest.fn().mockReturnValue({ aggregate });
    const db = { collection } as unknown as import('mongodb').Db;

    const repository = new MongoAtlasWatchlistCandidateRepository(db);

    await repository.findCandidates({
      organizationId: oid('org-1'),
      normalizedName: 'john smith',
      phoneticKeys: ['JN', 'SM0'],
      entryType: 'PERSON',
      limit: 15,
    });

    expect(collection).toHaveBeenCalledWith('watchlist_entries');
    expect(aggregate).toHaveBeenCalledTimes(1);
    const pipeline = aggregate.mock.calls[0]?.[0] as Array<Record<string, unknown>>;

    const search = pipeline[0]?.['$search'] as Record<string, unknown>;
    expect(search).toBeDefined();
    const compound = search['compound'] as Record<string, unknown>;
    expect(compound).toBeDefined();
    expect(Array.isArray((compound['should'] as unknown[]))).toBe(true);
    const should = compound['should'] as Array<Record<string, unknown>>;
    const hasTermsClause = should.some((clause) => 'text' in clause || 'terms' in Object.values(clause).flatMap((v) => (typeof v === 'object' && v !== null ? Object.keys(v) : [])));
    expect(hasTermsClause).toBe(true);

    const matchStage = pipeline.find((stage) => '$match' in stage) as Record<string, unknown> | undefined;
    expect(matchStage).toBeDefined();

    // Regression (Bugbot HIGH): organization_id must be a BSON ObjectId, not
    // the raw string, or Atlas matches nothing (the doc stores it as ObjectId).
    const match = matchStage?.['$match'] as Record<string, unknown>;
    expect(match['organization_id']).toBeInstanceOf(ObjectId);
    expect((match['organization_id'] as ObjectId).equals(new ObjectId(oid('org-1')))).toBe(true);

    const limitStage = pipeline.find((stage) => '$limit' in stage) as Record<string, unknown> | undefined;
    expect(limitStage).toBeDefined();
    expect(limitStage?.['$limit']).toBe(15);
  });

  it('returns empty without querying when no blocking fields are provided (parity with fallback)', async () => {
    const aggregate = jest.fn();
    const collection = jest.fn().mockReturnValue({ aggregate });
    const db = { collection } as unknown as import('mongodb').Db;

    const repository = new MongoAtlasWatchlistCandidateRepository(db);

    const result = await repository.findCandidates({
      organizationId: oid('org-1'),
      entryType: 'PERSON',
      limit: 15,
    });

    expect(result).toEqual([]);
    expect(aggregate).not.toHaveBeenCalled();
  });
});
