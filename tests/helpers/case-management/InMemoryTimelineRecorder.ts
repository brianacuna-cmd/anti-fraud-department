import { CaseTimelineEvent } from '../../../src/modules/case-management/domain/model/aggregates/CaseTimelineEvent.js';
import type { TimelineRecorder } from '../../../src/modules/case-management/domain/ports/TimelineRecorder.js';

/**
 * In-memory `TimelineRecorder` fake (mirrors `InMemoryAuditLogRepository`).
 * Map-backed, record-only — the real port exposes no read/update/delete
 * methods (append-only, YAGNI).
 */
export class InMemoryTimelineRecorder implements TimelineRecorder {
  private readonly byId = new Map<string, CaseTimelineEvent>();

  async record(event: CaseTimelineEvent): Promise<void> {
    if (this.byId.has(event.id)) {
      throw new Error(`CaseTimelineEvent "${event.id}" already recorded — timeline is append-only`);
    }
    this.byId.set(event.id, event);
  }

  async listByCaseId(caseId: string): Promise<readonly CaseTimelineEvent[]> {
    return [...this.byId.values()].filter((e) => e.caseId === caseId);
  }

  /** Test-only accessor — the real port exposes no read methods (append-only). */
  all(): readonly CaseTimelineEvent[] {
    return [...this.byId.values()];
  }
}
