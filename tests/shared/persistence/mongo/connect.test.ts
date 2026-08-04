import type { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo } from '../../../../src/shared/persistence/mongo/connect.js';
import { startReplicaSetMongo, startStandaloneMongo } from '../../../helpers/mongoTestServer.js';

jest.setTimeout(120_000);

describe('connectMongo (integration, real Mongo)', () => {
  describe('against a standalone (non-replica-set) instance', () => {
    let standalone: MongoMemoryServer;

    beforeAll(async () => {
      standalone = await startStandaloneMongo();
    });

    afterAll(async () => {
      await standalone.stop();
    });

    it('fails fast with an actionable --replSet rs0 hint instead of an ambiguous driver error', async () => {
      await expect(connectMongo(standalone.getUri(), 'anti_fraud_test')).rejects.toThrow(
        /--replSet rs0/,
      );
    });
  });

  describe('against a real replica-set instance', () => {
    let replicaSet: MongoMemoryReplSet;

    beforeAll(async () => {
      replicaSet = await startReplicaSetMongo();
    });

    afterAll(async () => {
      await replicaSet.stop();
    });

    it('connects successfully and returns a usable db handle', async () => {
      const connection = await connectMongo(replicaSet.getUri(), 'anti_fraud_test');

      try {
        const pingResult = await connection.db.command({ ping: 1 });
        expect(pingResult.ok).toBe(1);
      } finally {
        await connection.client.close();
      }
    });
  });
});
