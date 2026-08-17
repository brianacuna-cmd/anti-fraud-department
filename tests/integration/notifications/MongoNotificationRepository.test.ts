import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db, type MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../../../src/shared/persistence/mongo/ensureIndexes.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoNotificationRepository } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoNotificationRepository.js';
import { MongoUnitOfWork } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import { Notification } from '../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createNotificationId, generateNotificationId } from '../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { createOrganizationId } from '../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate } from '../../../src/shared/time/Instant.js';
import type { NotificationDocument } from '../../../src/modules/notifications/infrastructure/adapters/outbound/mongo/documents/NotificationDocument.js';
import { oid } from '../../support/oid.js';

jest.setTimeout(120_000);

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('MongoNotificationRepository (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let repository: MongoNotificationRepository;

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
    repository = new MongoNotificationRepository(db);
  });

  afterEach(async () => {
    await db.collection('notifications').deleteMany({});
  });

  it('save() inserts an append-only row keyed by the client-minted NotificationId', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const id = generateNotificationId();
    const notification = Notification.create({
      id,
      organizationId: createOrganizationId(oid('org-1')),
      recipientUserId: createUserId(oid('user-1')),
      alertType: 'CASO_ASIGNADO',
      channel: 'EMAIL',
      context: { caseId: oid('case-1') },
      now: NOW,
    });

    await unitOfWork.withTransaction((tx) => repository.save(notification, tx));

    const raw = await db.collection<NotificationDocument>('notifications').findOne({ _id: new ObjectId(id) });
    expect(raw).not.toBeNull();
    expect(raw?.alert_type).toBe('CASO_ASIGNADO');
    expect(raw?.recipient_user_id).toEqual(new ObjectId(oid('user-1')));
  });

  it('threads the tx session so a rolled-back transaction leaves no row', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const id = createNotificationId(oid('notification-rollback'));
    const notification = Notification.create({
      id,
      organizationId: createOrganizationId(oid('org-1')),
      recipientUserId: createUserId(oid('user-1')),
      alertType: 'CASO_ASIGNADO',
      channel: 'EMAIL',
      context: {},
      now: NOW,
    });

    await expect(
      unitOfWork.withTransaction(async (tx) => {
        await repository.save(notification, tx);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const raw = await db.collection<NotificationDocument>('notifications').findOne({ _id: new ObjectId(id) });
    expect(raw).toBeNull();
  });
});
