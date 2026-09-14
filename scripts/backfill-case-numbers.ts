import { connectMongo } from '../src/shared/persistence/mongo/connect.js';
import { runBackfillCaseNumbers } from './backfillCaseNumbersCore.js';

/**
 * One-time CLI: numbers the cases created before readable case numbers
 * existed. Safe to re-run. Run via `pnpm backfill:case-numbers`.
 *
 * Env:
 *   MONGO_URI, MONGO_DB_NAME — same defaults as `main.ts`.
 */
async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const mongoDbName = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';

  const { client, db } = await connectMongo(mongoUri, mongoDbName);
  try {
    const result = await runBackfillCaseNumbers(db);
    console.log(`Backfill complete: numbered ${result.numberedCount} case(s).`);
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error during case-number backfill:', error);
  process.exitCode = 1;
});
