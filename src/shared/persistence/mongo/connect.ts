import { MongoClient, type Db } from 'mongodb';

export interface MongoConnection {
  readonly client: MongoClient;
  readonly db: Db;
}

/**
 * Connects to Mongo and asserts the deployment is a replica set (required
 * for `session.withTransaction`, design D6). A standalone instance fails
 * `hello().setName` (undefined) — the app aborts here with an actionable
 * message instead of letting the first transactional write throw an
 * ambiguous driver error later (HTTP API Foundation spec: "App fails fast
 * without a replica set").
 */
export async function connectMongo(uri: string, dbName: string): Promise<MongoConnection> {
  const client = new MongoClient(uri);
  await client.connect();

  try {
    await assertReplicaSet(client);
  } catch (error) {
    await client.close();
    throw error;
  }

  return { client, db: client.db(dbName) };
}

async function assertReplicaSet(client: MongoClient): Promise<void> {
  const hello = await client.db().admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error(
      'MongoDB is not running as a replica set. This app requires transactions, ' +
        'which need a replica set. Restart Mongo with --replSet rs0 (and run ' +
        "'rs.initiate()' once) before starting the app again.",
    );
  }
}
