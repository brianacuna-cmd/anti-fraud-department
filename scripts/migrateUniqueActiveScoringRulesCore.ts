import type { Db, ObjectId } from 'mongodb';
import { ensureIndexes } from '../src/shared/persistence/mongo/ensureIndexes.js';

export interface DeactivateOlderActiveResult {
  readonly deactivatedCount: number;
}

interface ActiveDuplicateGroup {
  readonly _id: ObjectId;
  readonly ids: ObjectId[];
  readonly count: number;
}

/**
 * Counts organizations that still have more than one ACTIVE scoring rule.
 * Used as a fail-closed gate before creating the unique partial index.
 */
export async function countOrgsWithMultipleActiveScoringRules(db: Db): Promise<number> {
  const groups = await db
    .collection('risk_scoring_rules')
    .aggregate<{ count: number }>([
      { $match: { status: 'ACTIVE' } },
      { $group: { _id: '$organization_id', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  return groups.length;
}

/**
 * For each organization with multiple ACTIVE scoring rules, keeps the newest
 * (`updated_at` desc, then `_id` desc) ACTIVE and sets the rest to INACTIVE.
 */
export async function deactivateOlderActiveScoringRules(db: Db): Promise<DeactivateOlderActiveResult> {
  const duplicates = await db
    .collection('risk_scoring_rules')
    .aggregate<ActiveDuplicateGroup>([
      { $match: { status: 'ACTIVE' } },
      { $sort: { updated_at: -1, _id: -1 } },
      {
        $group: {
          _id: '$organization_id',
          ids: { $push: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  let deactivatedCount = 0;
  for (const group of duplicates) {
    const olderIds = group.ids.slice(1);
    if (olderIds.length === 0) {
      continue;
    }
    const result = await db
      .collection('risk_scoring_rules')
      .updateMany({ _id: { $in: olderIds } }, { $set: { status: 'INACTIVE' } });
    deactivatedCount += result.modifiedCount;
  }

  return { deactivatedCount };
}

/**
 * Migrate-then-index cutover: deactivate older ACTIVE duplicates, refuse if any
 * remain, then provision the unique partial ACTIVE index via `ensureIndexes`.
 */
export async function runMigrateUniqueActiveScoringRules(db: Db): Promise<DeactivateOlderActiveResult> {
  const result = await deactivateOlderActiveScoringRules(db);
  const remaining = await countOrgsWithMultipleActiveScoringRules(db);
  if (remaining > 0) {
    throw new Error(
      `fail-closed: ${remaining} organization(s) still have multiple ACTIVE scoring rules — unique index not created`,
    );
  }
  await ensureIndexes(db);
  return result;
}
