import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoFraudDepartmentDailyTalliesReader } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoFraudDepartmentDailyTalliesReader.js';
import { bogotaDayUtcRange } from '../../../src/shared/time/bogotaDay.js';
import type { CaseDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseDocument.js';
import type { ResolutionDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/ResolutionDocument.js';
import type { AnalystDecisionDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/AnalystDecisionDocument.js';
import type { CaseSlaTrackingDocument } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/documents/CaseSlaTrackingDocument.js';

jest.setTimeout(120_000);

const ORG = oid('org-1');
const BOGOTA_DAY = '2026-09-09';
const RISK_THRESHOLD_HIGH = 70;

// Bogota 2026-09-09 UTC range is [2026-09-09T05:00:00Z, 2026-09-10T05:00:00Z).
const IN_DAY_LATE = new Date('2026-09-10T04:30:00.000Z'); // 2026-09-09T23:30:00-05:00 — inside the day
const NEXT_DAY_EARLY = new Date('2026-09-10T05:30:00.000Z'); // 2026-09-10T00:30:00-05:00 — the next Bogota day

function buildCase(overrides: Partial<CaseDocument> & { _id: ObjectId }): CaseDocument {
  return {
    organization_id: new ObjectId(ORG),
    customer_id: 'cust-1',
    customer_email: null,
    bridge_user_id: null,
    bridge_wallet: null,
    stripe_customer_id: null,
    finturu_reference: null,
    finturu_cache_snapshot: null,
    idempotency_key: null,
    risk_score: 10,
    status: 'OPEN',
    priority: 'LOW',
    assigned_to: null,
    assigned_to_type: null,
    due_date: null,
    tags: [],
    created_at: new Date('2026-09-09T12:00:00.000Z'),
    updated_at: new Date('2026-09-09T12:00:00.000Z'),
    deleted_at: null,
    ...overrides,
  };
}

function buildResolution(overrides: Partial<ResolutionDocument> & { _id: ObjectId; case_id: ObjectId }): ResolutionDocument {
  return {
    organization_id: new ObjectId(ORG),
    closure_type: 'RESOLVED',
    reason: 'test',
    resolved_by: 'analyst-1',
    created_at: new Date('2026-09-09T12:00:00.000Z'),
    ...overrides,
  };
}

function buildDecision(
  overrides: Partial<AnalystDecisionDocument> & { _id: ObjectId; case_id: ObjectId },
): AnalystDecisionDocument {
  return {
    organization_id: new ObjectId(ORG),
    decision: 'FRAUD_CONFIRMED',
    confidence: 0.9,
    comment: 'test',
    created_by: new ObjectId(),
    created_at: new Date('2026-09-09T12:00:00.000Z'),
    ...overrides,
  };
}

function buildSlaTracking(
  overrides: Partial<CaseSlaTrackingDocument> & { _id: ObjectId; case_id: ObjectId },
): CaseSlaTrackingDocument {
  return {
    due_date: new Date('2026-09-10T12:00:00.000Z'),
    status: 'ON_TRACK',
    created_at: new Date('2026-09-09T12:00:00.000Z'),
    updated_at: new Date('2026-09-09T12:00:00.000Z'),
    ...overrides,
  };
}

describe('MongoFraudDepartmentDailyTalliesReader (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let reader: MongoFraudDepartmentDailyTalliesReader;

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

  beforeEach(() => {
    reader = new MongoFraudDepartmentDailyTalliesReader(db);
  });

  afterEach(async () => {
    await db.collection('cases').deleteMany({});
    await db.collection('resolutions').deleteMany({});
    await db.collection('analyst_decisions').deleteMany({});
    await db.collection('case_sla_tracking').deleteMany({});
  });

  function dayRange() {
    return bogotaDayUtcRange(BOGOTA_DAY);
  }

  it('returns all zeros on an empty day', async () => {
    const { dayStartUtc, dayEndUtc } = dayRange();

    const tallies = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(tallies).toEqual({
      casesCreated: 0,
      resolutionsTotal: 0,
      closedNotBreached: 0,
      decisionsTotal: 0,
      falsePositive: 0,
      modelPositiveFraud: 0,
      modelPositiveFalsePositive: 0,
    });
  });

  it('buckets cases by the America/Bogota calendar day, not UTC', async () => {
    await db.collection<CaseDocument>('cases').insertMany([
      buildCase({ _id: new ObjectId(), created_at: IN_DAY_LATE }),
      buildCase({ _id: new ObjectId(), created_at: NEXT_DAY_EARLY }),
    ]);
    const { dayStartUtc, dayEndUtc } = dayRange();

    const tallies = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(tallies.casesCreated).toBe(1);
  });

  it('excludes soft-deleted cases from casesCreated', async () => {
    await db.collection<CaseDocument>('cases').insertMany([
      buildCase({ _id: new ObjectId() }),
      buildCase({ _id: new ObjectId(), deleted_at: new Date('2026-09-09T15:00:00.000Z') }),
    ]);
    const { dayStartUtc, dayEndUtc } = dayRange();

    const tallies = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(tallies.casesCreated).toBe(1);
  });

  it('excludes BREACHED cases from closedNotBreached but counts them in resolutionsTotal', async () => {
    const caseA = new ObjectId();
    const caseB = new ObjectId();
    const caseC = new ObjectId();
    await db.collection<CaseDocument>('cases').insertMany([
      buildCase({ _id: caseA }),
      buildCase({ _id: caseB }),
      buildCase({ _id: caseC }),
    ]);
    await db.collection<ResolutionDocument>('resolutions').insertMany([
      buildResolution({ _id: new ObjectId(), case_id: caseA }),
      buildResolution({ _id: new ObjectId(), case_id: caseB }),
      buildResolution({ _id: new ObjectId(), case_id: caseC }),
    ]);
    await db.collection<CaseSlaTrackingDocument>('case_sla_tracking').insertMany([
      buildSlaTracking({ _id: new ObjectId(), case_id: caseA, status: 'ON_TRACK' }),
      buildSlaTracking({ _id: new ObjectId(), case_id: caseB, status: 'WARNING' }),
      buildSlaTracking({ _id: new ObjectId(), case_id: caseC, status: 'BREACHED' }),
    ]);
    const { dayStartUtc, dayEndUtc } = dayRange();

    const tallies = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(tallies.resolutionsTotal).toBe(3);
    expect(tallies.closedNotBreached).toBe(2);
  });

  it('computes decisionsTotal/falsePositive from analyst_decisions, and TP/FP respecting the risk threshold', async () => {
    const highRiskCase = new ObjectId();
    const lowRiskCase = new ObjectId();
    await db.collection<CaseDocument>('cases').insertMany([
      buildCase({ _id: highRiskCase, risk_score: 90 }),
      buildCase({ _id: lowRiskCase, risk_score: 20 }),
    ]);
    await db.collection<AnalystDecisionDocument>('analyst_decisions').insertMany([
      buildDecision({ _id: new ObjectId(), case_id: highRiskCase, decision: 'FRAUD_CONFIRMED' }),
      buildDecision({ _id: new ObjectId(), case_id: highRiskCase, decision: 'FALSE_POSITIVE' }),
      buildDecision({ _id: new ObjectId(), case_id: lowRiskCase, decision: 'FRAUD_CONFIRMED' }),
      buildDecision({ _id: new ObjectId(), case_id: highRiskCase, decision: 'INCONCLUSIVE' }),
    ]);
    const { dayStartUtc, dayEndUtc } = dayRange();

    const tallies = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(tallies.decisionsTotal).toBe(4);
    expect(tallies.falsePositive).toBe(1);
    // low-risk FRAUD_CONFIRMED excluded from model-positive tallies
    expect(tallies.modelPositiveFraud).toBe(1);
    expect(tallies.modelPositiveFalsePositive).toBe(1);
  });

  it('is deterministic/idempotent: running the same query twice returns identical tallies', async () => {
    const caseA = new ObjectId();
    await db.collection<CaseDocument>('cases').insertOne(buildCase({ _id: caseA, risk_score: 90 }));
    await db
      .collection<AnalystDecisionDocument>('analyst_decisions')
      .insertOne(buildDecision({ _id: new ObjectId(), case_id: caseA, decision: 'FRAUD_CONFIRMED' }));
    const { dayStartUtc, dayEndUtc } = dayRange();

    const first = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });
    const second = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(second).toEqual(first);
  });

  it('scopes tallies by organization', async () => {
    const otherOrg = oid('org-2');
    await db.collection<CaseDocument>('cases').insertMany([
      buildCase({ _id: new ObjectId(), organization_id: new ObjectId(ORG) }),
      buildCase({ _id: new ObjectId(), organization_id: new ObjectId(otherOrg) }),
    ]);
    const { dayStartUtc, dayEndUtc } = dayRange();

    const tallies = await reader.dailyTallies({
      organizationId: ORG,
      dayStartUtc,
      dayEndUtc,
      riskThresholdHigh: RISK_THRESHOLD_HIGH,
    });

    expect(tallies.casesCreated).toBe(1);
  });
});
