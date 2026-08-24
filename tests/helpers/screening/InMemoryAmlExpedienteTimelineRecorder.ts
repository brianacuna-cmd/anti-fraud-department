import type {
  AmlExpedienteTimelineEvent,
  AmlExpedienteTimelineRecorder,
} from '../../../src/modules/screening/domain/ports/AmlExpedienteTimelineRecorder.js';

/** In-memory fake for the AML expediente timeline recorder. */
export class InMemoryAmlExpedienteTimelineRecorder implements AmlExpedienteTimelineRecorder {
  private readonly events: AmlExpedienteTimelineEvent[] = [];

  async record(event: AmlExpedienteTimelineEvent): Promise<void> {
    this.events.push(event);
  }

  async listByAlertId(alertId: string): Promise<AmlExpedienteTimelineEvent[]> {
    return this.events
      .filter((event) => event.caseId === alertId)
      .sort((a, b) => (a.createdAt as string).localeCompare(b.createdAt as string));
  }

  all(): readonly AmlExpedienteTimelineEvent[] {
    return [...this.events];
  }
}
