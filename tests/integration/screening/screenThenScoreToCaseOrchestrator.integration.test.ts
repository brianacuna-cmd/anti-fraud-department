import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { SystemClock } from '../../../src/shared/time/SystemClock.js';
import { MongoAmlAlertRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlAlertRepository.js';
import { MongoAmlExpedienteTimelineRecorder } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoAmlExpedienteTimelineRecorder.js';
import { MongoUnitOfWork as ScreeningMongoUnitOfWork } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { MongoOutboxEventRepository } from '../../../src/shared/outbox/mongo/MongoOutboxEventRepository.js';
import { MongoFallbackWatchlistCandidateRepository } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/MongoFallbackWatchlistCandidateRepository.js';
import { TalismanPhoneticEncoder } from '../../../src/modules/screening/infrastructure/adapters/outbound/matching/TalismanPhoneticEncoder.js';
import { TalismanSimilarityCalculator } from '../../../src/modules/screening/infrastructure/adapters/outbound/matching/TalismanSimilarityCalculator.js';
import { createScreenSubjectAgainstWatchlistUseCase } from '../../../src/modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import { createOpenAmlAlertUseCase } from '../../../src/modules/screening/application/OpenAmlAlert.js';
import { generateAmlAlertId } from '../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { generateOutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import { generateObjectIdHex } from '../../../src/shared/kernel/ObjectIdHex.js';
import { createScreenThenScoreToCaseOrchestrator } from '../../../src/composition/screenThenScoreToCaseOrchestrator.js';
import type { ScoreToCaseOrchestratorInput, ScoreToCaseOrchestratorResult } from '../../../src/composition/scoreToCaseOrchestrator.js';
import type { CanonicalRiskEvent } from '../../../src/modules/risk-assessment/domain/model/CanonicalRiskEvent.js';
import type { WatchlistEntryDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

jest.setTimeout(60_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const AUTH = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

const STUB_SCORE_RESULT: ScoreToCaseOrchestratorResult = {
  riskScore: 10,
  ruleId: 'rule-1',
  conditionsVersion: 1,
  opened: false,
};

function buildEntry(overrides: Partial<WatchlistEntryDocument> = {}): WatchlistEntryDocument {
  return {
    _id: new ObjectId(oid(`entry-${Math.random()}`)),
    watchlist_id: new ObjectId(oid('watchlist-1')),
    organization_id: new ObjectId(oid('org-1')),
    tipo_entrada: 'PERSON',
    nombre: 'John Smith',
    nombre_normalizado: 'john smith',
    phonetic_keys: ['JN', 'SM0'],
    documento: null,
    wallet_address: null,
    nivel_riesgo: 'HIGH',
    pais: 'US',
    estado: 'ACTIVE',
    deleted_at: null,
    ...overrides,
  };
}

function buildEvent(nombre: string | undefined): CanonicalRiskEvent {
  return {
    provider: 'stripe',
    providerEventType: 'CHARGEBACK',
    caseCustomerId: oid('customer-1'),
    amountCents: 2500,
    currency: 'USD',
    riskSignals: nombre !== undefined ? { providerRiskScore: 10, nombre } : { providerRiskScore: 10 },
    createdAt: NOW,
  };
}

describe('screenThenScoreToCaseOrchestrator (integration, real Mongo, fallback candidate adapter)', () => {
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
    await db.collection('watchlist_entries').deleteMany({});
    await db.collection('aml_alerts').deleteMany({});
    await db.collection('case_timeline').deleteMany({});
    await db.collection('outbox_events').deleteMany({});
  });

  function buildOrchestrator(scoreToCaseOrchestrator: (input: ScoreToCaseOrchestratorInput) => Promise<ScoreToCaseOrchestratorResult>) {
    const openAmlAlert = createOpenAmlAlertUseCase({
      amlAlertRepository: new MongoAmlAlertRepository(db),
      timelineRecorder: new MongoAmlExpedienteTimelineRecorder(db),
      outbox: new MongoOutboxEventRepository(db),
      unitOfWork: new ScreeningMongoUnitOfWork(client),
      clock: new SystemClock(),
      generateAmlAlertId,
      generateTimelineEventId: generateObjectIdHex,
      generateOutboxEventId,
    });
    const screenSubject = createScreenSubjectAgainstWatchlistUseCase({
      watchlistCandidateRepository: new MongoFallbackWatchlistCandidateRepository(db),
      openAmlAlert,
      phoneticEncoder: new TalismanPhoneticEncoder(),
      similarityCalculator: new TalismanSimilarityCalculator(),
    });
    return createScreenThenScoreToCaseOrchestrator({ screenSubject, scoreToCaseOrchestrator });
  }

  it('confianza >= 70: persists an AmlAlert AND enriches riskSignals passed to scoring (camelCase)', async () => {
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(buildEntry());

    let receivedEvent: CanonicalRiskEvent | undefined;
    const process = buildOrchestrator(async (input) => {
      receivedEvent = input.event;
      return STUB_SCORE_RESULT;
    });

    const originalEvent = buildEvent('John Smith');
    await process({
      auth: AUTH,
      event: originalEvent,
      screening: { customerId: oid('customer-1'), entryType: 'PERSON', nombre: 'John Smith' },
    });

    expect(receivedEvent).not.toBe(originalEvent);
    expect(receivedEvent?.riskSignals.watchlistHit).toBe(true);
    expect(receivedEvent?.riskSignals.watchlistConfidence).toBeGreaterThanOrEqual(70);
    expect(typeof receivedEvent?.riskSignals.watchlistSource).toBe('string');
    expect(receivedEvent?.riskSignals.watchlistRiskLevel).toBe('HIGH');

    const alerts = await db.collection('aml_alerts').find({ customer_id: oid('customer-1') }).toArray();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.estado).toBe('OPEN');
    expect(alerts[0]?.severidad).toBe('HIGH');

    const timeline = await db.collection('case_timeline').find({ case_id: alerts[0]?._id }).toArray();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.event_type).toBe('CASE_CREATED');
    expect(timeline[0]?.new_value).toBe('OPEN');

    const events = await db.collection('outbox_events').find({ aggregate_id: alerts[0]?._id.toString() }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe('AML_ALERT_CREATED');
  });

  it('confianza in [50,70): writes an AmlAlert but does NOT enrich riskSignals', async () => {
    // "Mark Smith" shares two Double-Metaphone keys with "John Smith"
    // (SM0/XMT from the shared "Smith" surname, blocking finds it) but the
    // given name differs enough that the combined confianza formula
    // (0.4*phoneticAgreement + 0.6*jaroWinkler) lands deterministically at
    // 64 — inside [50,70), the ALERT_ONLY band (verified against the real
    // talisman adapters, not a fake, so this fixture is pinned to the
    // actual algorithm's output).
    await db.collection<WatchlistEntryDocument>('watchlist_entries').insertOne(
      buildEntry({ nombre: 'Mark Smith', nombre_normalizado: 'mark smith', phonetic_keys: ['MRK', 'SM0', 'XMT'] }),
    );

    let receivedEvent: CanonicalRiskEvent | undefined;
    const process = buildOrchestrator(async (input) => {
      receivedEvent = input.event;
      return STUB_SCORE_RESULT;
    });

    const originalEvent = buildEvent('John Smith');
    await process({
      auth: AUTH,
      event: originalEvent,
      screening: { customerId: oid('customer-2'), entryType: 'PERSON', nombre: 'John Smith' },
    });

    expect(receivedEvent).toBe(originalEvent);
    expect(receivedEvent?.riskSignals).not.toHaveProperty('watchlistHit');

    const alerts = await db.collection('aml_alerts').find({ customer_id: oid('customer-2') }).toArray();
    expect(alerts).toHaveLength(1);
  });

  it('no candidate found: passthrough unchanged (same event instance, no alert)', async () => {
    let receivedEvent: CanonicalRiskEvent | undefined;
    const process = buildOrchestrator(async (input) => {
      receivedEvent = input.event;
      return STUB_SCORE_RESULT;
    });

    const originalEvent = buildEvent('Nobody Here');
    const result = await process({
      auth: AUTH,
      event: originalEvent,
      screening: { customerId: oid('customer-3'), entryType: 'PERSON', nombre: 'Nobody Here' },
    });

    expect(result).toEqual(STUB_SCORE_RESULT);
    expect(receivedEvent).toBe(originalEvent);
    expect(receivedEvent?.riskSignals).toEqual(originalEvent.riskSignals);

    const alerts = await db.collection('aml_alerts').find({ customer_id: oid('customer-3') }).toArray();
    expect(alerts).toHaveLength(0);
  });
});
