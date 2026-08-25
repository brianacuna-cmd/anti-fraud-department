import type { Db } from 'mongodb';
import { toDate, type Instant } from '../../time/Instant.js';
import type { RoleDocument } from '../../../modules/identity-access/infrastructure/adapters/outbound/mongo/documents/RoleDocument.js';

interface RoleSeed {
  readonly id: string;
  readonly name: string;
}

const LEGACY_COLLECTION_NAME = 'rol';
const COLLECTION_NAME = 'roles';

/** Fixed role catalog (design "1. `Rol` collection + idempotent seed", user-roles). */
const ROLE_SEED: readonly RoleSeed[] = [
  { id: 'ADMIN', name: 'Administrator' },
  { id: 'SUPERVISOR', name: 'Supervisor' },
  { id: 'ANALYST', name: 'Analyst' },
  { id: 'AUDITOR', name: 'Auditor' },
];

/**
 * Seeds the fixed role catalog, idempotently. Per-row upsert with
 * `$setOnInsert` (CreatedAt/DeletedAt, written only on first insert) +
 * `$set` (RoleName/Status, re-asserted on every run so a manually-toggled
 * Status self-heals back to ACTIVE). Deliberately NOT `replaceOne` — that
 * would churn `CreatedAt` on every re-run. Safe to call on every bootstrap
 * (`ensureIndexes.ts` precedent).
 *
 * If a legacy `rol` collection exists and `roles` does not, it is renamed
 * in place so existing catalog rows are kept.
 */
export async function ensureRoles(db: Db, now: Instant): Promise<void> {
  await renameLegacyRolCollection(db);
  const collection = db.collection<RoleDocument>(COLLECTION_NAME);
  await Promise.all(
    ROLE_SEED.map((role) =>
      collection.updateOne(
        { _id: role.id },
        {
          $setOnInsert: { created_at: toDate(now), deleted_at: null },
          $set: { role_name: role.name, status: 'ACTIVE' },
        },
        { upsert: true },
      ),
    ),
  );
}

async function renameLegacyRolCollection(db: Db): Promise<void> {
  const existing = await db.listCollections({ name: { $in: [LEGACY_COLLECTION_NAME, COLLECTION_NAME] } }).toArray();
  const hasLegacy = existing.some((collection) => collection.name === LEGACY_COLLECTION_NAME);
  const hasCanonical = existing.some((collection) => collection.name === COLLECTION_NAME);
  if (hasLegacy && !hasCanonical) {
    await db.collection(LEGACY_COLLECTION_NAME).rename(COLLECTION_NAME);
  }
}
