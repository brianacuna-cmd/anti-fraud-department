import { runCreateFraudRules } from './createFraudRulesCore.js';

/**
 * Creates and activates the six payment fraud rules through the API.
 *
 *   FRAUD_API_URL=https://<host>/api/v1 FRAUD_API_TOKEN=<token de supervisor> \
 *     pnpm rules:create-fraud            # solo dice qué haría
 *   ... pnpm rules:create-fraud --confirm  # crea y activa
 *
 * The token is passed at run time and never stored. It must belong to a
 * SUPERVISOR of the organization the rule is for.
 */
async function main(): Promise<void> {
  const apiUrl = process.env.FRAUD_API_URL;
  const token = process.env.FRAUD_API_TOKEN;
  if (!apiUrl || !token) {
    throw new Error('FRAUD_API_URL y FRAUD_API_TOKEN son obligatorios');
  }
  await runCreateFraudRules({
    apiUrl,
    token,
    confirm: process.argv.includes('--confirm'),
    fetch: (url, init) => fetch(url, init),
    log: (line) => console.log(line),
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
