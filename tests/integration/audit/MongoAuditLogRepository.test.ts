import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { oid } from '../../support/oid.js';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoAuditLogRepository } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { AuditLog } from '../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { AuditLogDocument } from '../../../src/modules/audit/infrastructure/adapters/outbound/mongo/documents/AuditLogDocument.js';
import type { Transaction } from '../../../src/modules/audit/domain/ports/UnitOfWork.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildAuditLog(overrides: {
  id: string;
  organizationId?: string | null;
  action?: string;
}): AuditLog {
  return AuditLog.create({
    id: createAuditLogId(oid(overrides.id)),
    organizationId: overrides.organizationId === undefined ? oid('org-1') : overrides.organizationId,
    actorType: 'USER',
    actorId: oid('user-1'),
    action: overrides.action ?? 'USER_CREATED',
    resource: 'users',
    resourceId: oid('user-2'),
    detail: { field: 'value' },
    ipAddress: '127.0.0.1',
    createdAt: NOW,
  });
}

describe('MongoAuditLogRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoAuditLogRepository;

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
    repository = new MongoAuditLogRepository(db);
  });

  afterEach(async () => {
    await db.collection('audit_logs').deleteMany({});
  });

  it('persists an audit log', async () => {
    await repository.save(buildAuditLog({ id: 'audit-1' }));

    const rawDocument = await db.collection<AuditLogDocument>('audit_logs').findOne({ _id: new ObjectId(oid('audit-1')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?.action).toBe('USER_CREATED');
    expect(rawDocument?.organization_id).toEqual(new ObjectId(oid('org-1')));
    expect(rawDocument?.detail).toEqual({ field: 'value' });
  });

  it('persists an audit log with a null OrganizationId (PLATFORM_ADMIN outside a tenant)', async () => {
    await repository.save(buildAuditLog({ id: 'audit-2', organizationId: null }));

    const rawDocument = await db.collection<AuditLogDocument>('audit_logs').findOne({ _id: new ObjectId(oid('audit-2')) });

    expect(rawDocument?.organization_id).toBeNull();
  });

  it('joins the caller-supplied transaction — rolls back together with the enclosing write', async () => {
    const unitOfWork = new MongoUnitOfWork(client);

    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await repository.save(buildAuditLog({ id: 'audit-3' }), tx as unknown as Transaction);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const rawDocument = await db.collection<AuditLogDocument>('audit_logs').findOne({ _id: new ObjectId(oid('audit-3')) });
    expect(rawDocument).toBeNull();
  });

  it('commits together with the enclosing transaction when it succeeds', async () => {
    const unitOfWork = new MongoUnitOfWork(client);

    await unitOfWork.withTransaction(async (tx) => {
      await repository.save(buildAuditLog({ id: 'audit-4' }), tx as unknown as Transaction);
    });

    const rawDocument = await db.collection<AuditLogDocument>('audit_logs').findOne({ _id: new ObjectId(oid('audit-4')) });
    expect(rawDocument).not.toBeNull();
  });

  /**
   * Regression guard (inverted by the UUID -> native ObjectId migration):
   * `_id` is now persisted as a driver `ObjectId`, never a plain string.
   */
  it('round-trips the raw document by _id as a native ObjectId', async () => {
    await repository.save(buildAuditLog({ id: 'audit-id-guard' }));

    const rawDocument = await db
      .collection<AuditLogDocument>('audit_logs')
      .findOne({ _id: new ObjectId(oid('audit-id-guard')) });

    expect(rawDocument).not.toBeNull();
    expect(rawDocument?._id).toBeInstanceOf(ObjectId);
    expect(rawDocument?._id.toString()).toBe(oid('audit-id-guard'));
  });
});
