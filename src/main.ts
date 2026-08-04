import { createApp } from './shared/http/createApp.js';
import { createErrorHandler } from './shared/http/errorHandler.js';
import { connectMongo } from './shared/persistence/mongo/connect.js';
import { ensureIndexes } from './shared/persistence/mongo/ensureIndexes.js';

const PORT = Number(process.env.PORT ?? 3000);
const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';

async function bootstrap(): Promise<void> {
  const { db } = await connectMongo(MONGO_URI, MONGO_DB_NAME);
  await ensureIndexes(db);

  // Phase 2/3 build the resolver, repositories, and use cases here, then
  // pass their routers into `routers` below (identity-access organizations
  // and users). No routers exist yet in this bootstrap slice.
  const app = createApp({
    routers: [],
    errorHandler: createErrorHandler({}),
  });

  app.listen(PORT, () => {
    console.log(`anti-fraud-department listening on port ${PORT}`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('Fatal error during bootstrap:', error);
  process.exitCode = 1;
});
