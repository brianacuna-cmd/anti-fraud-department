import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoAmlAlertRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlAlertRepository.js';
import { AmlAlert } from '../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import type { AmlAlertDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/AmlAlertDocument.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

/**
 * Local-only unique index proving the natural-key idempotency contract
 * (design task 3.4 note). NOT yet in `ensureIndexes.ts` — Slice 6 promotes
 * this exact index shape into the shared index-bootstrap file so this
 * slice stays self-contained and independently mergeable.
 */
async function ensureLocalIdempotencyIndex(db: Db): Promise<void> {
  await db.collection<AmlAlertDocument>('aml_alerts').createIndex(
    {
      organization_id: 1,
      customer_id: 1,
      'matched_entry.entry_id': 1,
      'matched_entry.match_field': 1,
    },
    { unique: true, name: 'aml_alerts_natural_key_unique' },
  );
}

function buildAlert(overrides: { matchField?: 'NAME' | 'DOCUMENTO' | 'WALLET'; customerId?: string } = {}): AmlAlert {
  return AmlAlert.create({
    id: generateAmlAlertId(),
    organizationId: oid('org-1'),
    customerId: overrides.customerId ?? oid('customer-1'),
    entidadSospechosa: 'John Smith',
    confianza: createMatchScore(82),
    fuenteDeteccion: 'index',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      nombre: 'John Smith',
      documento: '123456789',
      nivelRiesgo: 'HIGH',
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
    await ensureLocalIdempotencyIndex(db);
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
    expect(found?.confianza).toBe(82);
  });

  it('returns null when no alert exists for the given id', async () => {
    const found = await repository.findById(generateAmlAlertId());
    expect(found).toBeNull();
  });

  it('is idempotent on the natural key: reprocessing the same alert creates only one record', async () => {
    const alert = buildAlert();

    await repository.save(alert);
    await repository.save(alert);

    const count = await db.collection('aml_alerts').countDocuments({});
    expect(count).toBe(1);
  });

  it('persists distinct records when match_field differs for the same subject/entry (not a duplicate)', async () => {
    const nameMatch = buildAlert({ matchField: 'NAME' });
    const documentoMatch = buildAlert({ matchField: 'DOCUMENTO' });

    await repository.save(nameMatch);
    await repository.save(documentoMatch);

    const count = await db.collection('aml_alerts').countDocuments({});
    expect(count).toBe(2);
  });
});
