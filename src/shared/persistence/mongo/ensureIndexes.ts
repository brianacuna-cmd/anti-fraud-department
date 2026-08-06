import type { Db } from 'mongodb';

/**
 * Provisions the indexes every `identity-access` repository relies on for
 * uniqueness and tenant-scoped lookups (HTTP API Foundation spec: "Required
 * Index Provisioning"). Named indexes so `duplicateKey.ts` (Phase 2) can
 * translate E11000 by index name, never by parsing the driver's message.
 * `createIndex` is idempotent — safe to call on every bootstrap.
 *
 * Design A2 (identity-access-schema-v2, PR3): collections and field KEYS are
 * PascalCase (`Organizations`/`Users`, `Slug`/`OrganizationId`/`Email`/
 * `Status`). Index NAMES stay snake_case (design A3) — only key casing
 * moved, the shape and uniqueness semantics are byte-identical to before.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db
    .collection('Organizations')
    .createIndex({ Slug: 1 }, { unique: true, name: 'slug_unique' });

  await db
    .collection('Users')
    .createIndex({ OrganizationId: 1, Email: 1 }, { unique: true, name: 'user_email_unique' });

  await db
    .collection('Users')
    .createIndex({ OrganizationId: 1, Status: 1 }, { name: 'user_status_idx' });

  // `AdminOrganization` (identity-access-super-admin-auth) is a separate
  // aggregate not in scope for schema-v2's PascalCase migration (design D39:
  // follow this repo's existing camelCase document convention) — deliberately
  // NOT PascalCase, unlike Organizations/Users above.
  await db
    .collection('adminOrganizations')
    .createIndex({ email: 1 }, { unique: true, name: 'admin_organization_email_unique' });

  await db
    .collection('adminOrganizations')
    .createIndex({ 'keys.keyId': 1 }, { name: 'admin_organization_keys_key_id_idx' });
}
