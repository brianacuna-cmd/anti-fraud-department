import { MongoClient, ObjectId, type Db } from 'mongodb';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startStandaloneMongo } from '../helpers/mongoTestServer.js';
import { createRegulatoryFigureSource } from '../../src/composition/regulatoryFigureSource.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { oid } from '../support/oid.js';

jest.setTimeout(120_000);

const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const SEP_START = fromDate(new Date('2026-09-01T00:00:00.000Z'));
const SEP_END = fromDate(new Date('2026-09-30T23:59:59.000Z'));
const SEP_MID = new Date('2026-09-15T12:00:00.000Z');
const OCT_MID = new Date('2026-10-15T12:00:00.000Z');

describe('createRegulatoryFigureSource', () => {
  let standalone: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    standalone = await startStandaloneMongo();
    client = new MongoClient(standalone.getUri());
    await client.connect();
    db = client.db('regulatory_figure_source_test');
  });

  afterAll(async () => {
    await client.close();
    await standalone.stop();
  });

  afterEach(async () => {
    await db.collection('audit_logs').deleteMany({});
    await db.collection('cases').deleteMany({});
    await db.collection('sar_reports').deleteMany({});
  });

  it('counts in-period events even after a later reversal, and never invents blockedAmount', async () => {
    const org = new ObjectId(ORG_1);
    const other = new ObjectId(ORG_2);
    await db.collection('audit_logs').insertMany([
      {
        organization_id: org,
        action: 'EXECUTE_ENFORCEMENT_ACTION',
        created_at: SEP_MID,
      },
      {
        organization_id: org,
        action: 'REVERT_ENFORCEMENT_ACTION',
        created_at: OCT_MID,
      },
      {
        organization_id: other,
        action: 'EXECUTE_ENFORCEMENT_ACTION',
        created_at: SEP_MID,
      },
    ]);
    await db.collection('cases').insertMany([
      { organization_id: org, created_at: SEP_MID },
      { organization_id: org, created_at: OCT_MID },
    ]);
    await db.collection('sar_reports').insertOne({
      organization_id: org,
      filed_at: SEP_MID,
      suspicious_amount: 1200,
    });

    const figures = await createRegulatoryFigureSource(db).compute({
      organizationId: ORG_1,
      periodStart: SEP_START,
      periodEnd: SEP_END,
    });

    // September executed; October revert must not erase the September event.
    expect(figures.enforcementExecuted).toBe(1);
    expect(figures.enforcementReverted).toBe(0);
    expect(figures.casesOpened).toBe(1);
    expect(figures.sarsFiled).toBe(1);
    expect(figures.suspiciousAmountDeclared).toBe(1200);
    expect(figures.blockedAmount).toBeNull();
  });
});
