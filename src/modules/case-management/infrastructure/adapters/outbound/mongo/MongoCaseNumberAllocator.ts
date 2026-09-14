import { ObjectId, type Collection, type Db } from 'mongodb';
import { toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import { formatCaseNumber, type CaseNumber } from '../../../../domain/model/value-objects/CaseNumber.js';
import type { CaseNumberAllocator } from '../../../../domain/ports/CaseNumberAllocator.js';

export const CASE_NUMBER_COUNTERS_COLLECTION = 'case_number_counters';

export interface CaseNumberCounterDocument {
  /** `<organizationId>:<year>` — the natural key, so no extra unique index is needed. */
  readonly _id: string;
  readonly organization_id: ObjectId;
  readonly year: number;
  readonly seq: number;
}

/**
 * One counter document per (organization, year), advanced with an atomic
 * `$inc` upsert. Runs outside any session on purpose (see
 * `CaseNumberAllocator`).
 */
export class MongoCaseNumberAllocator implements CaseNumberAllocator {
  private readonly collection: Collection<CaseNumberCounterDocument>;

  constructor(db: Db) {
    this.collection = db.collection<CaseNumberCounterDocument>(CASE_NUMBER_COUNTERS_COLLECTION);
  }

  async allocate(organizationId: string, at: Instant): Promise<CaseNumber> {
    const year = toDate(at).getUTCFullYear();
    const counter = await this.collection.findOneAndUpdate(
      { _id: `${organizationId}:${year}` },
      {
        $inc: { seq: 1 },
        $setOnInsert: { organization_id: new ObjectId(organizationId), year },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (counter === null) {
      throw new Error('case number counter upsert returned no document');
    }
    return formatCaseNumber(year, counter.seq);
  }
}
