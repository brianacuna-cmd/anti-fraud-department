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

  // `Sessions` (identity-access-authentication, design D14/D15/D38).
  await db
    .collection('Sessions')
    .createIndex({ TokenHash: 1 }, { unique: true, name: 'session_token_hash_unique' });

  // PARTIAL unique index, not plain and not sparse (design D38): a plain
  // unique index tolerates only ONE null/missing value across the whole
  // collection, so a second refresh-less PLATFORM_ADMIN session would be
  // rejected at insert with E11000. Sparse is also wrong here — this repo's
  // mappers always write an explicit `null`, never omit the key, so a
  // sparse index would still index every null and collide identically.
  // `$type: 'string'` filters on TYPE, not presence, so explicit nulls are
  // excluded either way — the only one of the three that is correct.
  await db.collection('Sessions').createIndex(
    { RefreshTokenHash: 1 },
    {
      unique: true,
      name: 'session_refresh_token_hash_unique',
      partialFilterExpression: { RefreshTokenHash: { $exists: true, $type: 'string' } },
    },
  );

  await db.collection('Sessions').createIndex({ FamilyId: 1 }, { name: 'session_family_id_idx' });

  // TTL sits on `FamilyExpiresAtDate` — a BSON Date MIRROR — never on the
  // `FamilyExpiresAt` ISO-string `Instant` field (design D15). Mongo's TTL
  // monitor acts only on a real BSON `Date`; a TTL index on the string field
  // is created successfully and silently deletes nothing.
  await db
    .collection('Sessions')
    .createIndex({ FamilyExpiresAtDate: 1 }, { name: 'session_family_expires_at_ttl_idx', expireAfterSeconds: 0 });

  await db
    .collection('Sessions')
    .createIndex({ OrganizationId: 1 }, { name: 'session_organization_id_idx' });

  await db
    .collection('Sessions')
    .createIndex({ ActorType: 1, UserId: 1 }, { name: 'session_actor_type_user_id_idx' });
}
