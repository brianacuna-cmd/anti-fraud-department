import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoFraudMetricsReader } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoFraudMetricsReader.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = new Date('2026-08-20T12:00:00.000Z');
const ORG = oid('metrics-org-1');
const OTHER_ORG = oid('metrics-org-2');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

interface CaseSeed {
  status?: string;
  priority?: string;
  riskScore?: number;
  assignedTo?: string | null;
  dueDate?: Date | null;
  createdAt?: Date;
  organizationId?: string;
  deletedAt?: Date | null;
}

function caseDoc(id: ObjectId, seed: CaseSeed = {}) {
  return {
    _id: id,
    organization_id: new ObjectId(seed.organizationId ?? ORG),
    customer_id: 'customer-1',
    customer_email: null,
    bridge_user_id: null,
    bridge_wallet: null,
    stripe_customer_id: null,
    finturu_reference: null,
    finturu_cache_snapshot: null,
    risk_score: seed.riskScore ?? 10,
    status: seed.status ?? 'OPEN',
    priority: seed.priority ?? 'MEDIUM',
    assigned_to: seed.assignedTo ?? null,
    assigned_to_type: seed.assignedTo ? 'USER' : null,
    due_date: seed.dueDate ?? null,
    tags: [],
    created_at: seed.createdAt ?? daysAgo(1),
    updated_at: seed.createdAt ?? daysAgo(1),
    deleted_at: seed.deletedAt ?? null,
  };
}

describe('MongoFraudMetricsReader (integration, real Mongo aggregations)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let reader: MongoFraudMetricsReader;

  const ANALYST_A = oid('metrics-analyst-a');
  const ANALYST_B = oid('metrics-analyst-b');
  const RESOLVED_CASE = new ObjectId(oid('metrics-case-resolved'));

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_metrics_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
    reader = new MongoFraudMetricsReader(db);

    await db.collection('cases').insertMany([
      // Vencido: abierto y con plazo pasado.
      caseDoc(new ObjectId(oid('metrics-case-1')), {
        status: 'OPEN',
        priority: 'CRITICAL',
        riskScore: 90,
        assignedTo: ANALYST_A,
        dueDate: daysAgo(2),
        createdAt: daysAgo(3),
      }),
      // En revision, en plazo, mismo responsable.
      caseDoc(new ObjectId(oid('metrics-case-2')), {
        status: 'IN_REVIEW',
        priority: 'HIGH',
        riskScore: 60,
        assignedTo: ANALYST_A,
        dueDate: new Date(NOW.getTime() + 86_400_000),
        createdAt: daysAgo(3),
      }),
      // Sin responsable.
      caseDoc(new ObjectId(oid('metrics-case-3')), {
        status: 'OPEN',
        priority: 'LOW',
        riskScore: 5,
        createdAt: daysAgo(1),
      }),
      caseDoc(new ObjectId(oid('metrics-case-4')), {
        status: 'OPEN',
        priority: 'MEDIUM',
        riskScore: 30,
        assignedTo: ANALYST_B,
        createdAt: daysAgo(1),
      }),
      caseDoc(RESOLVED_CASE, {
        status: 'RESOLVED',
        priority: 'HIGH',
        riskScore: 70,
        createdAt: daysAgo(3),
      }),
      // Borrado logico: no debe sumar en ninguna barra.
      caseDoc(new ObjectId(oid('metrics-case-deleted')), {
        status: 'OPEN',
        priority: 'CRITICAL',
        riskScore: 99,
        dueDate: daysAgo(5),
        deletedAt: daysAgo(1),
      }),
      // Another tenant: must never leak in.
      caseDoc(new ObjectId(oid('metrics-case-other')), {
        organizationId: OTHER_ORG,
        status: 'OPEN',
        priority: 'CRITICAL',
        riskScore: 95,
        dueDate: daysAgo(9),
      }),
      // Outside the 7-day window the test asks for.
      caseDoc(new ObjectId(oid('metrics-case-old')), {
        status: 'ARCHIVED',
        priority: 'LOW',
        riskScore: 1,
        createdAt: daysAgo(60),
      }),
    ]);

    await db.collection('resolutions').insertMany([
      {
        _id: new ObjectId(oid('metrics-resolution-1')),
        case_id: RESOLVED_CASE,
        organization_id: new ObjectId(ORG),
        closure_type: 'CONFIRMED_FRAUD',
        reason: 'confirmed',
        resolved_by: ANALYST_A,
        // Abierto hace 3 dias, cerrado hace 1: 48 h exactas.
        created_at: daysAgo(1),
      },
      {
        _id: new ObjectId(oid('metrics-resolution-other')),
        case_id: new ObjectId(oid('metrics-case-other')),
        organization_id: new ObjectId(OTHER_ORG),
        closure_type: 'FALSE_POSITIVE',
        reason: 'other tenant',
        resolved_by: ANALYST_B,
        created_at: daysAgo(1),
      },
      // Closure of a withdrawn case: its opening counts in no other bar, so
      // its closure cannot count in the series either.
      {
        _id: new ObjectId(oid('metrics-resolution-deleted')),
        case_id: new ObjectId(oid('metrics-case-deleted')),
        organization_id: new ObjectId(ORG),
        closure_type: 'CONFIRMED_FRAUD',
        reason: 'closed then withdrawn',
        resolved_by: ANALYST_A,
        created_at: daysAgo(1),
      },
    ]);

    await db.collection('enforcement_actions').insertMany([
      {
        _id: new ObjectId(oid('metrics-action-1')),
        case_id: new ObjectId(oid('metrics-case-1')),
        organization_id: new ObjectId(ORG),
        analyst_decision_id: new ObjectId(oid('metrics-decision-1')),
        action_type: 'BLOCK',
        target_type: 'WALLET',
        target_id: 'wallet-1',
        status: 'PENDING',
        created_by: new ObjectId(ANALYST_A),
        created_at: daysAgo(1),
        updated_at: daysAgo(1),
      },
      {
        _id: new ObjectId(oid('metrics-action-2')),
        case_id: new ObjectId(oid('metrics-case-2')),
        organization_id: new ObjectId(ORG),
        analyst_decision_id: new ObjectId(oid('metrics-decision-2')),
        action_type: 'REVIEW',
        target_type: 'CUSTOMER',
        target_id: 'customer-2',
        status: 'EXECUTED',
        created_by: new ObjectId(ANALYST_A),
        created_at: daysAgo(1),
        updated_at: daysAgo(1),
      },
      {
        _id: new ObjectId(oid('metrics-action-other')),
        case_id: new ObjectId(oid('metrics-case-other')),
        organization_id: new ObjectId(OTHER_ORG),
        analyst_decision_id: new ObjectId(oid('metrics-decision-3')),
        action_type: 'SUSPEND',
        target_type: 'WALLET',
        target_id: 'wallet-9',
        status: 'PENDING',
        created_by: new ObjectId(ANALYST_B),
        created_at: daysAgo(1),
        updated_at: daysAgo(1),
      },
    ]);
  });

  afterAll(async () => {
    await client?.close();
    await replicaSet?.stop();
  });

  it('counts cases by status and priority, excluding soft-deleted and other tenants', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.cases.byStatus).toEqual({ OPEN: 3, IN_REVIEW: 1, RESOLVED: 1, ARCHIVED: 1 });
    expect(snapshot.cases.total).toBe(6);
    expect(snapshot.cases.byPriority).toEqual({ CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 2 });
  });

  it('counts only ACTIVE cases as overdue or unassigned', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    // The other tenant's overdue case and the soft-deleted one stay out.
    expect(snapshot.cases.overdue).toBe(1);
    expect(snapshot.cases.unassigned).toBe(1);
  });

  it('buckets risk scores into the four fixed bands', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.cases.byRiskBucket).toEqual([
      { label: 'Bajo', from: 0, to: 24, count: 2 },
      { label: 'Medio', from: 25, to: 49, count: 1 },
      { label: 'Alto', from: 50, to: 74, count: 2 },
      { label: 'Crítico', from: 75, to: 100, count: 1 },
    ]);
  });

  /** Sin relleno de ceros la linea del panel se salta fechas. */
  it('returns one flow point per day in the window, zeros included', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.flow).toHaveLength(7);
    expect(snapshot.flow.map((point) => point.date)).toEqual([
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
    ]);
    expect(snapshot.flow.find((point) => point.date === '2026-08-17')).toEqual({
      date: '2026-08-17',
      opened: 3,
      resolved: 0,
    });
    expect(snapshot.flow.find((point) => point.date === '2026-08-19')).toEqual({
      date: '2026-08-19',
      opened: 2,
      resolved: 1,
    });
    expect(snapshot.flow.find((point) => point.date === '2026-08-16')?.opened).toBe(0);
  });

  it('groups enforcement actions by status and type within the tenant', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.enforcement.byStatus).toEqual({ PENDING: 1, EXECUTED: 1 });
    expect(snapshot.enforcement.byActionType).toEqual({ BLOCK: 1, REVIEW: 1 });
    expect(snapshot.enforcement.pendingApproval).toBe(1);
  });

  it('ranks assignees by open workload and counts their overdue cases', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.workload).toEqual([
      { assigneeId: ANALYST_A, assigneeType: 'USER', open: 2, overdue: 1 },
      { assigneeId: ANALYST_B, assigneeType: 'USER', open: 1, overdue: 0 },
    ]);
  });

  /**
   * The series counted `resolutions` as-is, so a withdrawn case added a
   * closure without ever adding an opening: there were days with more
   * closures than openings without anything unusual having happened.
   */
  it('excludes closures of soft-deleted cases from both the series and the average', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.flow.find((point) => point.date === '2026-08-19')?.resolved).toBe(1);
    expect(snapshot.resolution.resolvedInWindow).toBe(1);
  });

  it('measures time to resolve against the case creation date, per tenant', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 7,
      now: fromDate(NOW),
    });

    expect(snapshot.resolution).toEqual({ resolvedInWindow: 1, averageHoursToResolve: 48 });
  });

  it('reports no resolutions when the window predates every closure', async () => {
    const snapshot = await reader.snapshot({
      organizationId: ORG,
      windowDays: 1,
      now: fromDate(new Date('2026-09-30T12:00:00.000Z')),
    });

    expect(snapshot.resolution).toEqual({ resolvedInWindow: 0, averageHoursToResolve: null });
    expect(snapshot.flow).toEqual([{ date: '2026-09-30', opened: 0, resolved: 0 }]);
  });

  it('returns an empty-but-shaped snapshot for a tenant with no data', async () => {
    const snapshot = await reader.snapshot({
      organizationId: oid('metrics-org-empty'),
      windowDays: 3,
      now: fromDate(NOW),
    });

    expect(snapshot.cases.total).toBe(0);
    expect(snapshot.cases.byStatus).toEqual({});
    expect(snapshot.cases.byRiskBucket.every((bucket) => bucket.count === 0)).toBe(true);
    expect(snapshot.flow).toHaveLength(3);
    expect(snapshot.workload).toEqual([]);
  });
});
