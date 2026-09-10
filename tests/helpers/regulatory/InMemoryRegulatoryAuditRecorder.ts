import type {
  AuditEvent,
  AuditRecorder,
} from '../../../src/modules/regulatory/domain/ports/AuditRecorder.js';

export class InMemoryRegulatoryAuditRecorder implements AuditRecorder {
  private readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }
}
