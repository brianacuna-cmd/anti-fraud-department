import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { connectMongo } from '../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo } from '../../helpers/mongoTestServer.js';
import { MongoUnitOfWork } from '../../../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoUnitOfWork.js';
import type { Transaction } from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';

jest.setTimeout(120_000);

describe('MongoUnitOfWork (integration, real replica-set Mongo)', () => {
  let replicaSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  let unitOfWork: MongoUnitOfWork;

  beforeAll(async () => {
    replicaSet = await startReplicaSetMongo();
    const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');
    client = connection.client;
    db = connection.db;
  });

  afterAll(async () => {
    await client.close();
    await replicaSet.stop();
  });

  beforeEach(() => {
    unitOfWork = new MongoUnitOfWork(client);
  });

  afterEach(async () => {
    await db.collection<{ _id: string }>('uow_probe').deleteMany({});
  });

  it('runs the given work against a real session and returns its result', async () => {
    const result = await unitOfWork.withTransaction(async () => 'work-result');

    expect(result).toBe('work-result');
  });

  it('commits every write made through the opaque transaction handle', async () => {
    await unitOfWork.withTransaction(async (tx) => {
      const session = tx as unknown as ClientSession;
      await db.collection<{ _id: string }>('uow_probe').insertOne({ _id: 'probe-1' }, { session });
    });

    const found = await db.collection<{ _id: string }>('uow_probe').findOne({ _id: 'probe-1' });
    expect(found).not.toBeNull();
  });

  it('rolls back every write when the given work throws, leaving no partial state', async () => {
    await expect(
      unitOfWork.withTransaction(async (tx: Transaction) => {
        const session = tx as unknown as ClientSession;
        await db.collection<{ _id: string }>('uow_probe').insertOne({ _id: 'probe-2' }, { session });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const found = await db.collection<{ _id: string }>('uow_probe').findOne({ _id: 'probe-2' });
    expect(found).toBeNull();
  });
});
