import { writeFileSync } from 'node:fs';
import { connectMongo } from '../src/shared/persistence/mongo/connect.js';
import { ensureIndexes } from '../src/shared/persistence/mongo/ensureIndexes.js';
import { SystemClock } from '../src/shared/time/SystemClock.js';
import { MongoAdminOrganizationRepository } from '../src/modules/identity-access/infrastructure/adapters/outbound/mongo/MongoAdminOrganizationRepository.js';
import { AesGcmSecretCipher } from '../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { NodeAdminKeyPairGenerator } from '../src/modules/identity-access/infrastructure/adapters/outbound/crypto/NodeAdminKeyPairGenerator.js';
import { generateAdminOrganizationId } from '../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { generateAdminKeyId } from '../src/modules/identity-access/domain/model/value-objects/AdminKeyId.js';
import { MongoAuditLogRepository } from '../src/modules/audit/infrastructure/adapters/outbound/mongo/MongoAuditLogRepository.js';
import { createRecordAuditLogUseCase } from '../src/modules/audit/application/RecordAuditLog.js';
import { generateAuditLogId } from '../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { createAuditRecorderAdapter } from '../src/composition/auditRecorderAdapter.js';
import { runBootstrapAdmin } from './bootstrapAdminCore.js';

/**
 * One-time admin #0 provisioning CLI (design "Bootstrap script (admin #0)",
 * tasks 1c). Run via `pnpm run bootstrap:admin`. Bypasses `requirePlatformAdmin`
 * on purpose — on a fresh system there is no admin yet to authorize this —
 * but the `runBootstrapAdmin` guard (`countAll() > 0`) refuses a second run,
 * so this script can never create a second admin #0.
 *
 * Env:
 *   BOOTSTRAP_ADMIN_EMAIL  (required) — email for the new AdminOrganization.
 *   TOKEN_SECRET           (required in production; falls back to the same
 *                          dev-only default `main.ts` uses) — normalized via
 *                          SHA-256 into the AES-256-GCM key that encrypts the
 *                          private key at rest.
 *   TOKEN_KEY_VERSION      (default 1).
 *   MONGO_URI, MONGO_DB_NAME — same defaults as `main.ts`.
 *
 * Optional `--out <path>`: also writes the plaintext private key PEM to
 * `path` with `0600` permissions. Either way, the key is shown exactly
 * once here — it is never persisted in plaintext, and there is no way to
 * recover it later if it is lost.
 */
async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) {
    console.error('BOOTSTRAP_ADMIN_EMAIL is required.');
    process.exitCode = 1;
    return;
  }

  const tokenSecret = process.env.TOKEN_SECRET ?? 'dev-only-insecure-token-secret';
  const tokenKeyVersion = Number(process.env.TOKEN_KEY_VERSION ?? 1);
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const mongoDbName = process.env.MONGO_DB_NAME ?? 'anti_fraud_department';
  const outPath = readOutFlag(process.argv.slice(2));

  const { client, db } = await connectMongo(mongoUri, mongoDbName);
  try {
    await ensureIndexes(db);

    const clock = new SystemClock();
    const admins = new MongoAdminOrganizationRepository(db);
    const cipher = new AesGcmSecretCipher(tokenSecret, tokenKeyVersion);
    const keyPairs = new NodeAdminKeyPairGenerator();

    const auditLogs = new MongoAuditLogRepository(db);
    const recordAuditLog = createRecordAuditLogUseCase({ auditLogs, clock, generateAuditLogId });
    const auditRecorder = createAuditRecorderAdapter(recordAuditLog);

    const result = await runBootstrapAdmin(
      { admins, keyPairs, cipher, auditRecorder, clock, generateAdminOrganizationId, generateAdminKeyId },
      { email },
    );

    if (!result.ok) {
      console.error(result.reason);
      process.exitCode = 1;
      return;
    }

    console.log(`Provisioned AdminOrganization ${result.admin.id} (${result.admin.email}).`);
    console.log('Private key (PKCS8 PEM) — shown ONCE, never recoverable if lost:');
    console.log(result.privateKeyPkcs8Pem);

    if (outPath) {
      writeFileSync(outPath, result.privateKeyPkcs8Pem, { mode: 0o600 });
      console.log(`Also written to ${outPath} (mode 0600).`);
    }
  } finally {
    await client.close();
  }
}

function readOutFlag(args: readonly string[]): string | null {
  const index = args.indexOf('--out');
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

main().catch((error: unknown) => {
  console.error('Fatal error during admin bootstrap:', error);
  process.exitCode = 1;
});
