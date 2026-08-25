import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoAmlAlertRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlAlertRepository.js';
import { AmlAlert } from '../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildAlert(overrides: { matchField?: 'NAME' | 'DOCUMENT' | 'WALLET'; customerId?: string } = {}): AmlAlert {
  return AmlAlert.create({
    id: generateAmlAlertId(),
    organizationId: oid('org-1'),
    customerId: overrides.customerId ?? oid('customer-1'),
    suspectedEntity: 'John Smith',
    confidence: createMatchScore(82),
    detectionSource: 'index',
    severity: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      name: 'John Smith',
      document: '123456789',
      riskLevel: 'HIGH',
      matchField: overrides.matchField ?? 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

describe('MongoAmlAlertRepository (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoAmlAlertRepository;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    // Slice 6: idempotency index now lives in the shared ensureIndexes.ts
    // as the single source of truth (regression coverage for the same
    // natural-key uniqueness contract this test proved locally in Slice 3).
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    repository = new MongoAmlAlertRepository(db);
  });

  afterEach(async () => {
    await db.collection('aml_alerts').deleteMany({});
  });

  it('save / findById round-trip', async () => {
    const alert = buildAlert();

    await repository.save(alert);
    const found = await repository.findById(alert.id);

    expect(found?.id).toBe(alert.id);
    expect(found?.confidence).toBe(82);
    expect(found?.severity).toBe('HIGH');
  });

  it('returns null when no alert exists for the given id', async () => {
    const found = await repository.findById(generateAmlAlertId());
    expect(found).toBeNull();
  });

  it('upserts by _id so a status transition persists as updated, not a second row', async () => {
    const alert = buildAlert();

    await expect(repository.save(alert)).resolves.toBe('inserted');
    await expect(repository.save(alert.transitionTo('INVESTIGATING', NOW))).resolves.toBe('updated');

    const count = await db.collection('aml_alerts').countDocuments({});
    expect(count).toBe(1);
    const found = await repository.findById(alert.id);
    expect(found?.status).toBe('INVESTIGATING');
  });

  it('treats a different _id with the same natural key as duplicate', async () => {
    const first = buildAlert();
    const second = buildAlert();

    await expect(repository.save(first)).resolves.toBe('inserted');
    await expect(repository.save(second)).resolves.toBe('duplicate');

    const count = await db.collection('aml_alerts').countDocuments({});
    expect(count).toBe(1);
  });

  it('lists tenant alerts newest first and filters by status', async () => {
    const older = buildAlert({ customerId: oid('customer-older') });
    const newer = AmlAlert.create({
      id: generateAmlAlertId(),
      organizationId: oid('org-1'),
      customerId: oid('customer-newer'),
      suspectedEntity: 'Jane Doe',
      confidence: createMatchScore(82),
      detectionSource: 'index',
      severity: 'HIGH',
      matchedEntry: createScreeningMatch({
        entryId: createWatchlistEntryId(oid('entry-2')),
        watchlistId: createWatchlistId(oid('watchlist-1')),
        name: 'Jane Doe',
        document: '987654321',
        riskLevel: 'HIGH',
        matchField: 'NAME',
        algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
      }),
      now: fromDate(new Date('2026-01-02T00:00:00.000Z')),
    });
    await repository.save(older);
    await repository.save(newer);
    await repository.save(newer.transitionTo('INVESTIGATING', fromDate(new Date('2026-01-03T00:00:00.000Z'))));

    const all = await repository.list({
      organizationId: oid('org-1'),
      limit: 20,
      offset: 0,
    });
    expect(all.total).toBe(2);
    expect(all.items[0]?.customerId).toBe(oid('customer-newer'));

    const investigating = await repository.list({
      organizationId: oid('org-1'),
      status: ['INVESTIGATING'],
      limit: 20,
      offset: 0,
    });
    expect(investigating.total).toBe(1);
    expect(investigating.items[0]?.customerId).toBe(oid('customer-newer'));
  });

  it('persists an opaque non-hex customer_id (e.g. Stripe cus_...) as a plain string', async () => {
    const alert = buildAlert({ customerId: 'cus_9aFbZ_external' });

    await expect(repository.save(alert)).resolves.not.toThrow();

    const stored = await db.collection('aml_alerts').findOne({ customer_id: 'cus_9aFbZ_external' });
    expect(stored).not.toBeNull();
    const roundTripped = await repository.findById(alert.id);
    expect(roundTripped?.customerId).toBe('cus_9aFbZ_external');
  });

  it('treats a concurrent duplicate-key race as an idempotent no-op instead of throwing', async () => {
    // Two distinct alert instances (different _id) with the SAME natural key.
    // Under find-then-insert both may find nothing and race to insert; the
    // unique index rejects the loser with E11000, which save() must swallow.
    const a = buildAlert();
    const b = buildAlert();

    await expect(Promise.all([repository.save(a), repository.save(b)])).resolves.not.toThrow();

    const count = await db.collection('aml_alerts').countDocuments({});
    expect(count).toBe(1);
  });

  it('persists distinct records when match_field differs for the same subject/entry (not a duplicate)', async () => {
    const nameMatch = buildAlert({ matchField: 'NAME' });
    const documentMatch = buildAlert({ matchField: 'DOCUMENT' });

    await repository.save(nameMatch);
    await repository.save(documentMatch);

    const count = await db.collection('aml_alerts').countDocuments({});
    expect(count).toBe(2);
  });

  it('filters by severity, watchlist_id, and created_at range, combined with AND', async () => {
    const watchlistA = oid('watchlist-a');
    const watchlistB = oid('watchlist-b');
    const low = AmlAlert.create({
      id: generateAmlAlertId(),
      organizationId: oid('org-1'),
      customerId: oid('customer-low'),
      suspectedEntity: 'Low Sev',
      confidence: createMatchScore(60),
      detectionSource: 'index',
      severity: 'LOW',
      matchedEntry: createScreeningMatch({
        entryId: createWatchlistEntryId(oid('entry-low')),
        watchlistId: createWatchlistId(watchlistA),
        name: 'Low Sev',
        matchField: 'NAME',
        algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
      }),
      now: fromDate(new Date('2026-01-01T00:00:00.000Z')),
    });
    const highOldWatchlist = AmlAlert.create({
      id: generateAmlAlertId(),
      organizationId: oid('org-1'),
      customerId: oid('customer-high-old'),
      suspectedEntity: 'High Old',
      confidence: createMatchScore(90),
      detectionSource: 'index',
      severity: 'HIGH',
      matchedEntry: createScreeningMatch({
        entryId: createWatchlistEntryId(oid('entry-high-old')),
        watchlistId: createWatchlistId(watchlistB),
        name: 'High Old',
        matchField: 'NAME',
        algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
      }),
      now: fromDate(new Date('2026-01-02T00:00:00.000Z')),
    });
    const highMatch = AmlAlert.create({
      id: generateAmlAlertId(),
      organizationId: oid('org-1'),
      customerId: oid('customer-high-match'),
      suspectedEntity: 'High Match',
      confidence: createMatchScore(95),
      detectionSource: 'index',
      severity: 'HIGH',
      matchedEntry: createScreeningMatch({
        entryId: createWatchlistEntryId(oid('entry-high-match')),
        watchlistId: createWatchlistId(watchlistA),
        name: 'High Match',
        matchField: 'NAME',
        algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
      }),
      now: fromDate(new Date('2026-01-05T00:00:00.000Z')),
    });
    await repository.save(low);
    await repository.save(highOldWatchlist);
    await repository.save(highMatch);

    const bySeverity = await repository.list({
      organizationId: oid('org-1'),
      severity: ['HIGH'],
      limit: 20,
      offset: 0,
    });
    expect(bySeverity.total).toBe(2);

    const byWatchlist = await repository.list({
      organizationId: oid('org-1'),
      watchlistId: watchlistA,
      limit: 20,
      offset: 0,
    });
    expect(byWatchlist.total).toBe(2);

    const byRange = await repository.list({
      organizationId: oid('org-1'),
      createdAfter: fromDate(new Date('2026-01-02T00:00:00.000Z')),
      createdBefore: fromDate(new Date('2026-01-03T00:00:00.000Z')),
      limit: 20,
      offset: 0,
    });
    expect(byRange.total).toBe(1);
    expect(byRange.items[0]?.customerId).toBe(oid('customer-high-old'));

    const combined = await repository.list({
      organizationId: oid('org-1'),
      severity: ['HIGH'],
      watchlistId: watchlistA,
      limit: 20,
      offset: 0,
    });
    expect(combined.total).toBe(1);
    expect(combined.items[0]?.customerId).toBe(oid('customer-high-match'));

    const noMatch = await repository.list({
      organizationId: oid('org-1'),
      severity: ['LOW'],
      watchlistId: watchlistB,
      limit: 20,
      offset: 0,
    });
    expect(noMatch.total).toBe(0);
    expect(noMatch.items).toEqual([]);
  });

  it('findByNaturalKey returns the stored alert', async () => {
    const alert = buildAlert();
    await repository.save(alert);

    const found = await repository.findByNaturalKey({
      organizationId: alert.organizationId,
      customerId: alert.customerId,
      entryId: String(alert.matchedEntry.entryId),
      matchField: alert.matchedEntry.matchField,
    });

    expect(found?.id).toBe(alert.id);
    expect(found?.severity).toBe('HIGH');
  });
});
