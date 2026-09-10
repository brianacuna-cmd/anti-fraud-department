import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoNotificationOrgConfigRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationOrgConfigRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { NotificationOrgConfig } from '../../../src/modules/notifications/domain/model/aggregates/NotificationOrgConfig.js';
import { createNotificationOrgConfigId } from '../../../src/modules/notifications/domain/model/value-objects/NotificationOrgConfigId.js';
import { createOrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

describe('MongoNotificationOrgConfigRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoNotificationOrgConfigRepository;

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
    repository = new MongoNotificationOrgConfigRepository(db);
  });

  afterEach(async () => {
    await db.collection('notification_org_config').deleteMany({});
  });

  it('upsert() creates a new row on first call', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const desired = NotificationOrgConfig.create({
      id: createNotificationOrgConfigId(oid('config-1')),
      organizationId: createOrganizationId(oid('org-1')),
      webhookUrl: 'https://hooks.example.com/x',
      now: NOW,
    });

    await unitOfWork.withTransaction((tx) => repository.upsert(desired, tx));

    const raw = await db.collection('notification_org_config').findOne({
      organization_id: new ObjectId(oid('org-1')),
    });
    expect(raw).not.toBeNull();
    expect(raw?.webhook_url).toBe('https://hooks.example.com/x');
  });

  it('upsert() updates in place (not duplicated) on a repeated PUT', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const first = NotificationOrgConfig.create({
      id: createNotificationOrgConfigId(oid('config-1')),
      organizationId: createOrganizationId(oid('org-1')),
      webhookUrl: 'https://hooks.example.com/first',
      now: NOW,
    });
    await unitOfWork.withTransaction((tx) => repository.upsert(first, tx));

    const second = NotificationOrgConfig.create({
      id: createNotificationOrgConfigId(oid('config-2')),
      organizationId: createOrganizationId(oid('org-1')),
      webhookUrl: 'https://hooks.example.com/second',
      now: LATER,
    });
    await unitOfWork.withTransaction((tx) => repository.upsert(second, tx));

    const rows = await db
      .collection('notification_org_config')
      .find({ organization_id: new ObjectId(oid('org-1')) })
      .toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.webhook_url).toBe('https://hooks.example.com/second');
  });

  it('findByOrganization() returns null when absent, and tenant-scopes correctly', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    await unitOfWork.withTransaction((tx) =>
      repository.upsert(
        NotificationOrgConfig.create({
          id: createNotificationOrgConfigId(oid('config-a')),
          organizationId: createOrganizationId(oid('org-a')),
          webhookUrl: 'https://hooks.example.com/a',
          now: NOW,
        }),
        tx,
      ),
    );

    const absent = await repository.findByOrganization(createOrganizationId(oid('org-b')));
    expect(absent).toBeNull();

    const found = await repository.findByOrganization(createOrganizationId(oid('org-a')));
    expect(found?.webhookUrl).toBe('https://hooks.example.com/a');
  });

  it('rejects a duplicate organization_id with a real E11000 (notification_org_config_unique)', async () => {
    await db.collection('notification_org_config').insertOne({
      _id: new ObjectId(),
      organization_id: new ObjectId(oid('org-dup')),
      webhook_url: null,
      secret: null,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await expect(
      db.collection('notification_org_config').insertOne({
        _id: new ObjectId(),
        organization_id: new ObjectId(oid('org-dup')),
        webhook_url: null,
        secret: null,
        created_at: new Date(),
        updated_at: new Date(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
