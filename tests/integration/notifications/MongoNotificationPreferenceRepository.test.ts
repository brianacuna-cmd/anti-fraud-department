import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoNotificationPreferenceRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationPreferenceRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { NotificationPreference } from '../../../src/modules/notifications/domain/model/aggregates/NotificationPreference.js';
import { createOrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { NotificationPreferenceDocument } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/documents/NotificationPreferenceDocument.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

describe('MongoNotificationPreferenceRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoNotificationPreferenceRepository;

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
    repository = new MongoNotificationPreferenceRepository(db);
  });

  afterEach(async () => {
    await db.collection('NotificationPreferences').deleteMany({});
  });

  it('upsert() inserts a new row when none exists, generating an ObjectId _id (design D1/D4)', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const desired = NotificationPreference.create({
      organizationId: createOrganizationId(oid('org-1')),
      userId: createUserId(oid('user-1')),
      alertType: 'CASO_ASIGNADO',
      channel: 'EMAIL',
      enabled: false,
      now: NOW,
    });

    const saved = await unitOfWork.withTransaction((tx) => repository.upsert(desired, tx));

    expect(saved.enabled).toBe(false);
    expect(saved.createdAt).toBe(NOW);
    expect(saved.updatedAt).toBe(NOW);

    const raw = await db.collection<NotificationPreferenceDocument>('NotificationPreferences').findOne({
      OrganizationId: oid('org-1'),
      UserId: oid('user-1'),
      AlertType: 'CASO_ASIGNADO',
      Channel: 'EMAIL',
    });
    expect(raw).not.toBeNull();
    expect(raw?._id).toBeDefined();
  });

  it('upsert() updates Enabled/UpdatedAt in place and preserves the original CreatedAt on a second call (design D5)', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const first = NotificationPreference.create({
      organizationId: createOrganizationId(oid('org-1')),
      userId: createUserId(oid('user-1')),
      alertType: 'SLA_POR_VENCER',
      channel: 'EMAIL',
      enabled: true,
      now: NOW,
    });
    await unitOfWork.withTransaction((tx) => repository.upsert(first, tx));

    const second = NotificationPreference.create({
      organizationId: createOrganizationId(oid('org-1')),
      userId: createUserId(oid('user-1')),
      alertType: 'SLA_POR_VENCER',
      channel: 'EMAIL',
      enabled: false,
      now: LATER,
    });
    const saved = await unitOfWork.withTransaction((tx) => repository.upsert(second, tx));

    expect(saved.enabled).toBe(false);
    expect(saved.updatedAt).toBe(LATER);
    expect(saved.createdAt).toBe(NOW);

    const rows = await db.collection('NotificationPreferences').find({ UserId: oid('user-1') }).toArray();
    expect(rows).toHaveLength(1);
  });

  it('findByUser() returns only the rows for that (organizationId, userId)', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    await unitOfWork.withTransaction((tx) =>
      repository.upsert(
        NotificationPreference.create({
          organizationId: createOrganizationId(oid('org-1')),
          userId: createUserId(oid('user-1')),
          alertType: 'APROBACION_PENDIENTE',
          channel: 'EMAIL',
          enabled: false,
          now: NOW,
        }),
        tx,
      ),
    );
    await unitOfWork.withTransaction((tx) =>
      repository.upsert(
        NotificationPreference.create({
          organizationId: createOrganizationId(oid('org-2')),
          userId: createUserId(oid('user-2')),
          alertType: 'RIESGO_CRITICO',
          channel: 'EMAIL',
          enabled: false,
          now: NOW,
        }),
        tx,
      ),
    );

    const rows = await repository.findByUser(createOrganizationId(oid('org-1')), createUserId(oid('user-1')));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.alertType).toBe('APROBACION_PENDIENTE');
  });

  it('rejects a duplicate (organizationId, userId, alertType, channel) key with a real E11000 (notification_preference_user_alert_channel_unique)', async () => {
    await db.collection<NotificationPreferenceDocument>('NotificationPreferences').insertOne({
      _id: new ObjectId(),
      OrganizationId: oid('org-1'),
      UserId: 'user-dup',
      AlertType: 'RIESGO_CRITICO',
      Channel: 'EMAIL',
      Enabled: true,
      CreatedAt: NOW,
      UpdatedAt: NOW,
    });

    await expect(
      db.collection<NotificationPreferenceDocument>('NotificationPreferences').insertOne({
        _id: new ObjectId(),
        OrganizationId: oid('org-1'),
        UserId: 'user-dup',
        AlertType: 'RIESGO_CRITICO',
        Channel: 'EMAIL',
        Enabled: false,
        CreatedAt: NOW,
        UpdatedAt: NOW,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('two concurrent upserts of the same key: exactly one row survives, Enabled reflects a winner (design D10)', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const buildDesired = (enabled: boolean, now = NOW) =>
      NotificationPreference.create({
        organizationId: createOrganizationId(oid('org-concurrency')),
        userId: createUserId(oid('user-concurrency')),
        alertType: 'CASO_ASIGNADO',
        channel: 'EMAIL',
        enabled,
        now,
      });

    await Promise.all([
      unitOfWork.withTransaction((tx) => repository.upsert(buildDesired(true), tx)),
      unitOfWork.withTransaction((tx) => repository.upsert(buildDesired(false), tx)),
    ]);

    const rows = await db
      .collection('NotificationPreferences')
      .find({ OrganizationId: oid('org-concurrency'), UserId: oid('user-concurrency') })
      .toArray();
    expect(rows).toHaveLength(1);
  });
});
