import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Starts a REAL standalone (non-replica-set) mongod for negative tests that
 * must observe the app's fail-fast behavior when no replica set is present.
 */
export async function startStandaloneMongo(): Promise<MongoMemoryServer> {
  return MongoMemoryServer.create();
}

/**
 * Starts a REAL single-node replica set — the actual topology the app
 * requires for transactions (design D6, `session.withTransaction`).
 */
export async function startReplicaSetMongo(): Promise<MongoMemoryReplSet> {
  return MongoMemoryReplSet.create({ replSet: { count: 1 } });
}
