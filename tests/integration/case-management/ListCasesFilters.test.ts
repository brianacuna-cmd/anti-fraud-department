import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoCaseRepository } from '../../../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseRepository.js';
import { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createAssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

jest.setTimeout(120_000);

const ORG = 'org-filters';
const OTHER_ORG = 'org-other';
const T0 = fromDate(new Date('2026-01-10T00:00:00.000Z'));

describe('CASE-004 case listing filters (integration)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let cases: MongoCaseRepository;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_filters_test');
    client = connection.client;
    db = connection.db;
    await ensureIndexes(db);
    cases = new MongoCaseRepository(db);

    const seed = async (overrides: {
      customerId: string;
      status?: string;
      priority?: string;
      riskScore?: number;
      tags?: string[];
      assignee?: string;
      createdAt?: string;
      organizationId?: string;
      email?: string;
    }) => {
      let kase = Case.create({
        id: generateCaseId(),
        organizationId: overrides.organizationId ?? ORG,
        customerId: overrides.customerId,
        customerEmail: overrides.email ?? null,
        riskScore: createRiskScore(overrides.riskScore ?? 50),
        priority: createCasePriority(overrides.priority ?? 'LOW'),
        tags: overrides.tags ?? [],
        now: fromDate(new Date(overrides.createdAt ?? T0)),
      });
      if (overrides.assignee) {
        kase = kase.reassign(createAssignedTo('USER', overrides.assignee), T0);
      }
      if (overrides.status && overrides.status !== 'OPEN') {
        kase = kase.transitionTo('IN_REVIEW', T0);
        if (overrides.status === 'RESOLVED') kase = kase.transitionTo('RESOLVED', T0);
      }
      await cases.save(kase);
      return kase;
    };

    await seed({ customerId: 'c-open-low', status: 'OPEN', priority: 'LOW', riskScore: 10, tags: ['A'] });
    await seed({ customerId: 'c-review-high', status: 'IN_REVIEW', priority: 'HIGH', riskScore: 80, tags: ['A', 'B'], assignee: 'analyst-1' });
    await seed({ customerId: 'c-resolved-crit', status: 'RESOLVED', priority: 'CRITICAL', riskScore: 95, tags: ['B'] });
    await seed({ customerId: 'c-old', createdAt: '2025-06-01T00:00:00.000Z', priority: 'MEDIUM', riskScore: 40 });
    await seed({ customerId: 'c-mail', email: 'target+alias@finturu.com', riskScore: 60 });
    await seed({ customerId: 'c-open-low', organizationId: OTHER_ORG });
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  const ids = (items: readonly Case[]) => items.map((c) => c.customerId).sort();

  it('scopes to one tenant and never leaks another’s cases', async () => {
    const page = await cases.list({ organizationId: ORG });
    expect(page.items.every((c) => c.organizationId === ORG)).toBe(true);
    expect(page.items).toHaveLength(5);
  });

  it('filters by a single status', async () => {
    const page = await cases.list({ organizationId: ORG, status: 'RESOLVED' });
    expect(ids(page.items)).toEqual(['c-resolved-crit']);
  });

  it('filters by several statuses at once', async () => {
    const page = await cases.list({ organizationId: ORG, status: ['IN_REVIEW', 'RESOLVED'] });
    expect(ids(page.items)).toEqual(['c-resolved-crit', 'c-review-high']);
  });

  it('treats ALL as "do not filter"', async () => {
    const page = await cases.list({ organizationId: ORG, status: 'ALL' });
    expect(page.items).toHaveLength(5);
  });

  it('filters by priority', async () => {
    const page = await cases.list({ organizationId: ORG, priority: ['HIGH', 'CRITICAL'] });
    expect(ids(page.items)).toEqual(['c-resolved-crit', 'c-review-high']);
  });

  it('filters by risk score range, inclusive at both ends', async () => {
    const page = await cases.list({ organizationId: ORG, riskScoreMin: 60, riskScoreMax: 80 });
    expect(ids(page.items)).toEqual(['c-mail', 'c-review-high']);
  });

  it('requires ALL requested tags, not any of them', async () => {
    const both = await cases.list({ organizationId: ORG, tags: ['A', 'B'] });
    expect(ids(both.items)).toEqual(['c-review-high']);

    const justA = await cases.list({ organizationId: ORG, tags: ['A'] });
    expect(ids(justA.items)).toEqual(['c-open-low', 'c-review-high']);
  });

  it('filters by assignee and by the unassigned inbox', async () => {
    const mine = await cases.list({ organizationId: ORG, assignedToId: 'analyst-1' });
    expect(ids(mine.items)).toEqual(['c-review-high']);

    const inbox = await cases.list({ organizationId: ORG, assignedToType: 'UNASSIGNED' });
    expect(inbox.items).toHaveLength(4);
    expect(inbox.items.every((c) => c.assignedTo === null)).toBe(true);
  });

  it('filters by creation date range', async () => {
    const page = await cases.list({ organizationId: ORG, createdTo: '2025-12-31T23:59:59.999Z' });
    expect(ids(page.items)).toEqual(['c-old']);
  });

  it('searches across customer identifiers without breaking on regex metacharacters', async () => {
    const page = await cases.list({ organizationId: ORG, search: 'target+alias@finturu.com' });
    expect(ids(page.items)).toEqual(['c-mail']);
  });

  it('counts with the same predicate the listing uses', async () => {
    const filter = { organizationId: ORG, priority: ['HIGH', 'CRITICAL'] } as const;
    const page = await cases.list(filter);
    await expect(cases.countAll(filter)).resolves.toBe(page.items.length);
  });

  it('hides soft-deleted cases from both list and count', async () => {
    await db.collection('Cases').updateOne(
      { CustomerId: 'c-old', OrganizationId: ORG },
      { $set: { DeletedAt: new Date().toISOString() } },
    );

    const page = await cases.list({ organizationId: ORG });
    expect(ids(page.items)).not.toContain('c-old');
    await expect(cases.countAll({ organizationId: ORG })).resolves.toBe(4);

    await db.collection('Cases').updateOne({ CustomerId: 'c-old', OrganizationId: ORG }, { $set: { DeletedAt: null } });
  });

  it('paginates by cursor without repeating or dropping rows', async () => {
    const first = await cases.list({ organizationId: ORG, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await cases.list({ organizationId: ORG, limit: 2, cursor: first.nextCursor! });
    const overlap = ids(first.items).filter((id) => ids(second.items).includes(id));
    expect(overlap).toEqual([]);
  });
});
