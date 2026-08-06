import type { Db } from 'mongodb';

/**
 * Provisions the indexes every `identity-access` repository relies on for
 * uniqueness and tenant-scoped lookups (HTTP API Foundation spec: "Required
 * Index Provisioning"). Named indexes so `duplicateKey.ts` (Phase 2) can
 * translate E11000 by index name, never by parsing the driver's message.
 * `createIndex` is idempotent — safe to call on every bootstrap.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db
    .collection('organizations')
    .createIndex({ slug: 1 }, { unique: true, name: 'slug_unique' });

  await db
    .collection('users')
    .createIndex({ organizationId: 1, email: 1 }, { unique: true, name: 'user_email_unique' });

  await db
    .collection('users')
    .createIndex({ organizationId: 1, status: 1 }, { name: 'user_status_idx' });

  await db
    .collection('adminOrganizations')
    .createIndex({ email: 1 }, { unique: true, name: 'admin_organization_email_unique' });

  await db
    .collection('adminOrganizations')
    .createIndex({ 'keys.keyId': 1 }, { name: 'admin_organization_keys_key_id_idx' });
}
