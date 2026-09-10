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
      alertType: 'CASE_ASSIGNED',
      channel: 'EMAIL',
      context: { caseId: oid('case-1') },
      now: NOW,
    });

    await unitOfWork.withTransaction((tx) => repository.save(notification, tx));

    const raw = await db.collection<NotificationDocument>('notifications').findOne({ _id: new ObjectId(id) });
    expect(raw).not.toBeNull();
    expect(raw?.alert_type).toBe('CASE_ASSIGNED');
    expect(raw?.recipient_user_id).toEqual(new ObjectId(oid('user-1')));
  });

  it('threads the tx session so a rolled-back transaction leaves no row', async () => {
    const unitOfWork = new MongoUnitOfWork(client);
    const id = createNotificationId(oid('notification-rollback'));
    const notification = Notification.create({
      id,
      organizationId: createOrganizationId(oid('org-1')),
      recipientUserId: createUserId(oid('user-1')),
      alertType: 'CASE_ASSIGNED',
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

  describe('findByRecipient / findById / markRead (R3/R4 persistence)', () => {
    const orgId = createOrganizationId(oid('org-1'));
    const userA = createUserId(oid('user-a'));
    const userB = createUserId(oid('user-b'));

    async function seed(recipient = userA, at = NOW, status: 'UNREAD' | 'READ' = 'UNREAD') {
      const id = generateNotificationId();
      let notification = Notification.create({
        id,
        organizationId: orgId,
        recipientUserId: recipient,
        alertType: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        context: {},
        now: at,
      });
      if (status === 'READ') {
        notification = notification.markRead(at);
      }
      await repository.save(notification);
      return notification;
    }

    it('save then findByRecipient returns it', async () => {
      const notification = await seed();

      const page = await repository.findByRecipient(orgId, userA, { limit: 10, offset: 0 });

      expect(page.total).toBe(1);
      expect(page.items[0]?.id).toBe(notification.id);
    });

    it('paginates with limit/offset, newest-first', async () => {
      const t0 = NOW;
      const t1 = fromDate(new Date('2026-01-02T00:00:00.000Z'));
      const t2 = fromDate(new Date('2026-01-03T00:00:00.000Z'));
      const first = await seed(userA, t0);
      const second = await seed(userA, t1);
      const third = await seed(userA, t2);

      const page = await repository.findByRecipient(orgId, userA, { limit: 2, offset: 0 });
      expect(page.total).toBe(3);
      expect(page.items.map((n) => n.id)).toEqual([third.id, second.id]);

      const nextPage = await repository.findByRecipient(orgId, userA, { limit: 2, offset: 2 });
      expect(nextPage.items.map((n) => n.id)).toEqual([first.id]);
    });

    it('status=UNREAD filter excludes READ notifications', async () => {
      const unread = await seed(userA, NOW, 'UNREAD');
      await seed(userA, NOW, 'READ');

      const page = await repository.findByRecipient(orgId, userA, { status: 'UNREAD', limit: 10, offset: 0 });

      expect(page.total).toBe(1);
      expect(page.items[0]?.id).toBe(unread.id);
    });

    it('is tenant+user scoped — never returns another user or org row', async () => {
      await seed(userA);
      await seed(userB);
      const otherOrg = createOrganizationId(oid('org-2'));
      const id = generateNotificationId();
      await repository.save(
        Notification.create({
          id,
          organizationId: otherOrg,
          recipientUserId: userA,
          alertType: 'CASE_ASSIGNED',
          channel: 'EMAIL',
          context: {},
          now: NOW,
        }),
      );

      const page = await repository.findByRecipient(orgId, userA, { limit: 10, offset: 0 });

      expect(page.total).toBe(1);
      expect(page.items.every((n) => n.recipientUserId === userA && n.organizationId === orgId)).toBe(true);
    });

    it('markRead flips the row and is reflected on reload', async () => {
      const notification = await seed();

      const read = notification.markRead(fromDate(new Date('2026-01-05T00:00:00.000Z')));
      await repository.markRead(read);

      const reloaded = await repository.findById(notification.id);
      expect(reloaded?.status).toBe('READ');
    });

    it('markRead is idempotent', async () => {
      const notification = await seed();
      const read = notification.markRead(fromDate(new Date('2026-01-05T00:00:00.000Z')));
      await repository.markRead(read);

      await expect(repository.markRead(read)).resolves.toBeUndefined();

      const reloaded = await repository.findById(notification.id);
      expect(reloaded?.status).toBe('READ');
    });

    it('tolerantly reads a legacy doc missing status/updated_at as UNREAD', async () => {
      const id = generateNotificationId();
      await db.collection<NotificationDocument>('notifications').insertOne({
        _id: new ObjectId(id),
        organization_id: new ObjectId(orgId),
        recipient_user_id: new ObjectId(userA),
        alert_type: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        context: {},
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      } as NotificationDocument);

      const found = await repository.findById(id);

      expect(found?.status).toBe('UNREAD');
      expect(found?.updatedAt).toEqual(fromDate(new Date('2026-01-01T00:00:00.000Z')));
    });
  });

  describe('markAllReadForRecipient (R6 bulk mark-all-read)', () => {
    const orgId = createOrganizationId(oid('org-1'));
    const userA = createUserId(oid('user-a'));
    const userB = createUserId(oid('user-b'));

    async function seed(recipient = userA, org = orgId, status: 'UNREAD' | 'READ' = 'UNREAD') {
      const id = generateNotificationId();
      let notification = Notification.create({
        id,
        organizationId: org,
        recipientUserId: recipient,
        alertType: 'CASE_ASSIGNED',
        channel: 'EMAIL',
        context: {},
        now: NOW,
      });
      if (status === 'READ') {
        notification = notification.markRead(NOW);
      }
      await repository.save(notification);
      return notification;
    }

    it('flips only the matching UNREAD rows and returns modifiedCount, leaving updated_at on the pre-existing READ doc untouched', async () => {
      await seed(userA, orgId, 'UNREAD');
      await seed(userA, orgId, 'UNREAD');
      await seed(userA, orgId, 'UNREAD');
      const preRead = await seed(userA, orgId, 'READ');
      await seed(userA, orgId, 'UNREAD');

      const at = fromDate(new Date('2026-02-01T00:00:00.000Z'));
      const count = await repository.markAllReadForRecipient(orgId, userA, at);

      expect(count).toBe(4);
      const page = await repository.findByRecipient(orgId, userA, { limit: 10, offset: 0 });
      expect(page.items.every((n) => n.status === 'READ')).toBe(true);
      const reloadedPreRead = await repository.findById(preRead.id);
      expect(reloadedPreRead?.updatedAt).toEqual(preRead.updatedAt);
    });

    it('leaves another recipient in the same org untouched', async () => {
      await seed(userA, orgId, 'UNREAD');
      await seed(userB, orgId, 'UNREAD');

      await repository.markAllReadForRecipient(orgId, userA, fromDate(new Date('2026-02-01T00:00:00.000Z')));

      const otherPage = await repository.findByRecipient(orgId, userB, { limit: 10, offset: 0 });
      expect(otherPage.items.every((n) => n.status === 'UNREAD')).toBe(true);
    });

    it('leaves the same recipientUserId under a different organization untouched', async () => {
      const otherOrg = createOrganizationId(oid('org-2'));
      await seed(userA, orgId, 'UNREAD');
      await seed(userA, otherOrg, 'UNREAD');

      await repository.markAllReadForRecipient(orgId, userA, fromDate(new Date('2026-02-01T00:00:00.000Z')));

      const otherOrgPage = await repository.findByRecipient(otherOrg, userA, { limit: 10, offset: 0 });
      expect(otherOrgPage.items.every((n) => n.status === 'UNREAD')).toBe(true);
    });

    it('returns 0 and modifies nothing when there are no UNREAD rows', async () => {
      await seed(userA, orgId, 'READ');

      const count = await repository.markAllReadForRecipient(orgId, userA, fromDate(new Date('2026-02-01T00:00:00.000Z')));

      expect(count).toBe(0);
    });
  });

  it('ensureIndexes creates notification_recipient_status_created_idx without colliding with the existing index', async () => {
    const indexes = await db.collection('notifications').indexes();
    const names = indexes.map((i) => i.name);
    expect(names).toContain('notification_recipient_created_idx');
    expect(names).toContain('notification_recipient_status_created_idx');
  });
});
