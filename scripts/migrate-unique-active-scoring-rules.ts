import { connectMongo } from '../src/shared/persistence/mongo/connect.js';
import { runMigrateUniqueActiveScoringRules } from './migrateUniqueActiveScoringRulesCore.js';

/**
 * One-time cutover CLI: deactivate older duplicate ACTIVE `risk_scoring_rules`
 * (keep newest by `updated_at` then `_id`), then ensure the unique partial
 * ACTIVE index. Run via `pnpm exec tsx scripts/migrate-unique-active-scoring-rules.ts`.
 *
 * Env:
 *   MONGO_URI, MONGO_DB_NAME — same defaults as `main.ts`.
 */
async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const mongoDbName = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';

  const { client, db } = await connectMongo(mongoUri, mongoDbName);
  try {
    const result = await runMigrateUniqueActiveScoringRules(db);
    console.log(
      `Migration complete: deactivated ${result.deactivatedCount} older ACTIVE scoring rule(s); unique partial index ensured.`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error('Fatal error during unique ACTIVE scoring-rules migration:', error);
  process.exitCode = 1;
});
