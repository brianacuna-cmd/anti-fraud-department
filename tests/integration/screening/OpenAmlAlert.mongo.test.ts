import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { createOpenAmlAlertUseCase } from '../../../src/modules/screening/application/OpenAmlAlert.js';
import { generateAmlAlertId } from '../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { MongoAmlAlertRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlAlertRepository.js';
import { MongoAmlExpedienteTimelineRecorder } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlExpedienteTimelineRecorder.js';
import { MongoUnitOfWork } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoOutboxEventRepository } from '../../../src/shared/outbox/mongo/MongoOutboxEventRepository.js';
import { generateOutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import { generateObjectIdHex } from '../../../src/shared/kernel/ObjectIdHex.js';
import { FixedClock } from '../../helpers/FixedClock.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const AUTH = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

function buildMatch() {
  return createScreeningMatch({
    entryId: createWatchlistEntryId(oid('entry-1')),
    watchlistId: createWatchlistId(oid('watchlist-1')),
    name: 'John Smith',
    document: '123456789',
    riskLevel: 'HIGH',
    matchField: 'NAME',
    algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
  });
}

describe('OpenAmlAlert (integration, real Mongo transaction)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  afterEach(async () => {
    await db.collection('aml_alerts').deleteMany({});
    await db.collection('case_timeline').deleteMany({});
    await db.collection('outbox_events').deleteMany({});
  });

  function buildUseCase() {
    return createOpenAmlAlertUseCase({
      amlAlertRepository: new MongoAmlAlertRepository(db),
      timelineRecorder: new MongoAmlExpedienteTimelineRecorder(db),
      outbox: new MongoOutboxEventRepository(db),
      unitOfWork: new MongoUnitOfWork(client),
      clock: new FixedClock(NOW),
      generateAmlAlertId,
      generateTimelineEventId: generateObjectIdHex,
      generateOutboxEventId,
    });
  }

  it('commits aml_alerts OPEN + calculated severity, case_timeline CASE_CREATED, and outbox AML_ALERT_CREATED together', async () => {
    const openAmlAlert = buildUseCase();

    const result = await openAmlAlert({
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch(),
      confidence: createMatchScore(82),
    });

    expect(result.opened).toBe(true);
    expect(result.alert?.status).toBe('OPEN');
    expect(result.alert?.severity).toBe('HIGH');

    const alerts = await db.collection('aml_alerts').find({}).toArray();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.estado).toBe('OPEN');
    expect(alerts[0]?.severidad).toBe('HIGH');

    const timeline = await db.collection('case_timeline').find({}).toArray();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.event_type).toBe('CASE_CREATED');
    expect(timeline[0]?.new_value).toBe('OPEN');
    expect(timeline[0]?.case_id.toString()).toBe(String(result.alert?.id));

    const events = await db.collection('outbox_events').find({}).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('AML_ALERT_CREATED');
    expect(events[0]?.aggregate_type).toBe('aml_alerts');
    expect(events[0]?.status).toBe('PENDING');
  });

  it('does not write timeline or outbox on a natural-key duplicate', async () => {
    const openAmlAlert = buildUseCase();
    const input = {
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch(),
      confidence: createMatchScore(82),
    };

    await openAmlAlert(input);
    const second = await openAmlAlert(input);

    expect(second.duplicate).toBe(true);
    expect(await db.collection('aml_alerts').countDocuments({})).toBe(1);
    expect(await db.collection('case_timeline').countDocuments({})).toBe(1);
    expect(await db.collection('outbox_events').countDocuments({})).toBe(1);
  });
});
