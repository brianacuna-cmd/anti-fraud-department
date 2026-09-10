import type {
  SubjectDataSource,
  SubjectRecord,
  SubjectSelector,
} from '../../../src/modules/privacy/domain/ports/SubjectDataSource.js';

/**
 * Records are seeded whole, including their `retainedUntil`.
 *
 * That mirrors the real adapter's contract exactly: computing the retention
 * window is the ADAPTER's job, and the domain's job is deciding what to do
 * with it. A fake that recomputed the window would be testing a rule the
 * production code does not have.
 */
export class FakeSubjectDataSource implements SubjectDataSource {
  private readonly records: SubjectRecord[] = [];
  private readonly maskedIds: string[] = [];

  seed(record: SubjectRecord): void {
    this.records.push(record);
  }

  async findRecords(_organizationId: string, _subject: SubjectSelector): Promise<readonly SubjectRecord[]> {
    return this.records;
  }

  async maskRecords(_organizationId: string, recordIds: readonly string[]): Promise<number> {
    this.maskedIds.push(...recordIds);
    return recordIds.length;
  }

  masked(): readonly string[] {
    return this.maskedIds;
  }
}
