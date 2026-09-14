import type { Db, ObjectId } from 'mongodb';
import { ensureIndexes } from '../src/shared/persistence/mongo/ensureIndexes.js';
import { fromDate } from '../src/shared/time/Instant.js';
import { MongoCaseNumberAllocator } from '../src/modules/case-management/infrastructure/adapters/outbound/mongo/MongoCaseNumberAllocator.js';

export interface BackfillCaseNumbersResult {
  readonly numberedCount: number;
}

interface UnnumberedCase {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly created_at: Date;
}

const WITHOUT_NUMBER = { $or: [{ case_number: { $exists: false } }, { case_number: null }] };

/**
 * Gives a readable `case_number` to every case created before numbering
 * existed, oldest first, through the SAME counters new cases use — so a
 * backfilled number can never collide with one handed out live.
 *
 * Idempotent: only cases still without a number are touched, and each write
 * re-checks that condition, so a second run (or a run racing live traffic)
 * numbers nothing twice. The year comes from the case's own `created_at`.
 */
export async function runBackfillCaseNumbers(db: Db): Promise<BackfillCaseNumbersResult> {
  await ensureIndexes(db);
  const allocator = new MongoCaseNumberAllocator(db);
  const cursor = db
    .collection<UnnumberedCase>('cases')
    .find(WITHOUT_NUMBER, { projection: { _id: 1, organization_id: 1, created_at: 1 } })
    .sort({ created_at: 1, _id: 1 });

  let numberedCount = 0;
  for await (const row of cursor) {
    const caseNumber = await allocator.allocate(row.organization_id.toString(), fromDate(row.created_at));
    const result = await db
      .collection('cases')
      .updateOne({ _id: row._id, ...WITHOUT_NUMBER }, { $set: { case_number: caseNumber } });
    numberedCount += result.modifiedCount;
  }
  return { numberedCount };
}
