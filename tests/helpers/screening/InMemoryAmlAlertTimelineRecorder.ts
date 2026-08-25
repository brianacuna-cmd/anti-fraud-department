import type {
  AmlAlertTimelineEvent,
  AmlAlertTimelineRecorder,
} from '../../../src/modules/screening/domain/ports/AmlAlertTimelineRecorder.js';

/** In-memory fake for the AML alert timeline recorder. */
export class InMemoryAmlAlertTimelineRecorder implements AmlAlertTimelineRecorder {
  private readonly events: AmlAlertTimelineEvent[] = [];

  async record(event: AmlAlertTimelineEvent): Promise<void> {
    this.events.push(event);
  }

  async listByAlertId(alertId: string): Promise<AmlAlertTimelineEvent[]> {
    return this.events
      .filter((event) => event.caseId === alertId)
      .sort((a, b) => (a.createdAt as string).localeCompare(b.createdAt as string));
  }

  all(): readonly AmlAlertTimelineEvent[] {
    return [...this.events];
  }
}
