import { CaseTimelineEvent } from '../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineRecorder } from '../../../src/modules/case-management/domain/ports/TimelineRecorder.js';
import type { TimelineReader } from '../../../src/modules/case-management/domain/ports/TimelineReader.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';

/**
 * In-memory fake for both timeline ports: the write side (`TimelineRecorder`,
 * append-only) and the read side (`TimelineReader`, oldest-first per case),
 * sharing one map so a test can record then read back.
 */
export class InMemoryTimelineRecorder implements TimelineRecorder, TimelineReader {
  private readonly byId = new Map<string, CaseTimelineEvent>();

  async record(event: CaseTimelineEvent): Promise<void> {
    if (this.byId.has(event.id)) {
      throw new Error(`CaseTimelineEvent "${event.id}" already recorded — timeline is append-only`);
    }
    this.byId.set(event.id, event);
  }

  async listByCaseId(caseId: CaseId): Promise<CaseTimelineEvent[]> {
    return [...this.byId.values()]
      .filter((event) => (event.caseId as string) === (caseId as string))
      .sort((a, b) => (a.createdAt as string).localeCompare(b.createdAt as string));
  }

  /** Test-only accessor. */
  all(): readonly CaseTimelineEvent[] {
    return [...this.byId.values()];
  }
}
