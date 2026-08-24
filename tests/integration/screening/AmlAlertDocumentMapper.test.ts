import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { AmlAlert } from '../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { toDocument, toDomain } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/mappers/AmlAlertDocumentMapper.js';
import type { AmlAlertDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/AmlAlertDocument.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildAlert(): AmlAlert {
  return AmlAlert.create({
    id: generateAmlAlertId(),
    organizationId: oid('org-1'),
    customerId: oid('customer-1'),
    entidadSospechosa: 'John Smith',
    confianza: createMatchScore(82),
    fuenteDeteccion: 'index',
    severidad: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      nombre: 'John Smith',
      documento: '123456789',
      nivelRiesgo: 'HIGH',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

describe('AmlAlertDocument mapper (integration, real Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  afterEach(async () => {
    await db.collection('aml_alerts').deleteMany({});
  });

  it('round-trips through toDocument/toDomain preserving all fields', async () => {
    const alert = buildAlert();

    await db.collection<AmlAlertDocument>('aml_alerts').insertOne(toDocument(alert));
    const found = await db.collection<AmlAlertDocument>('aml_alerts').findOne({});

    expect(found).not.toBeNull();
    const rehydrated = toDomain(found!);

    expect(rehydrated.id).toBe(alert.id);
    expect(rehydrated.organizationId).toBe(alert.organizationId);
    expect(rehydrated.customerId).toBe(alert.customerId);
    expect(rehydrated.tipoAlerta).toBe('WATCHLIST_MATCH');
    expect(rehydrated.entidadSospechosa).toBe('John Smith');
    expect(rehydrated.confianza).toBe(82);
    expect(rehydrated.fuenteDeteccion).toBe('index');
    expect(rehydrated.estado).toBe('OPEN');
    expect(rehydrated.severidad).toBe('HIGH');
    expect(rehydrated.caseId).toBeNull();
    expect(rehydrated.matchedEntry).toEqual(alert.matchedEntry);
    expect(rehydrated.createdAt).toBe(alert.createdAt);
    expect(rehydrated.updatedAt).toBe(alert.updatedAt);
  });

  it('stores document fields snake_case, including the embedded matched_entry snapshot', async () => {
    const alert = buildAlert();

    await db.collection<AmlAlertDocument>('aml_alerts').insertOne(toDocument(alert));
    const raw = await db.collection('aml_alerts').findOne({});

    expect(raw).toMatchObject({
      organization_id: expect.anything(),
      customer_id: expect.anything(),
      tipo_alerta: 'WATCHLIST_MATCH',
      entidad_sospechosa: 'John Smith',
      confianza: 82,
      fuente_deteccion: 'index',
      estado: 'OPEN',
      severidad: 'HIGH',
      case_id: null,
      matched_entry: {
        entry_id: expect.anything(),
        watchlist_id: expect.anything(),
        nombre: 'John Smith',
        documento: '123456789',
        nivel_riesgo: 'HIGH',
        match_field: 'NAME',
        algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
      },
    });
  });

  it('round-trips a linked caseId (non-null)', async () => {
    const alert = buildAlert().linkCase(oid('case-1'), NOW);

    await db.collection<AmlAlertDocument>('aml_alerts').insertOne(toDocument(alert));
    const found = await db.collection<AmlAlertDocument>('aml_alerts').findOne({});
    const rehydrated = toDomain(found!);

    expect(rehydrated.caseId).toBe(oid('case-1'));
  });
});
