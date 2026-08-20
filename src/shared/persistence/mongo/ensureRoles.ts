import type { Db } from 'mongodb';
import { toDate, type Instant } from '../../time/Instant.js';
import type { RolDocument } from '../../../modules/identity-access/infrastructure/adapters/outbound/mongo/documents/RolDocument.js';

interface RoleSeed {
  readonly id: string;
  readonly name: string;
}

/** Fixed role catalog (design "1. `Rol` collection + idempotent seed", user-roles). */
const ROLE_SEED: readonly RoleSeed[] = [
  { id: 'ADMIN', name: 'Administrator' },
  { id: 'SUPERVISOR', name: 'Supervisor' },
  { id: 'ANALYST', name: 'Analyst' },
  { id: 'AUDITOR', name: 'Auditor' },
];

/**
 * Seeds the fixed `Rol` catalog, idempotently. Per-row upsert with
 * `$setOnInsert` (CreatedAt/DeletedAt, written only on first insert) +
 * `$set` (RoleName/Status, re-asserted on every run so a manually-toggled
 * Status self-heals back to ACTIVE). Deliberately NOT `replaceOne` — that
 * would churn `CreatedAt` on every re-run. Safe to call on every bootstrap
 * (`ensureIndexes.ts` precedent).
 */
export async function ensureRoles(db: Db, now: Instant): Promise<void> {
  const collection = db.collection<RolDocument>('rol');
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
