import type {
  AuditEvent,
  AuditRecorder,
} from '../../../src/modules/privacy/domain/ports/AuditRecorder.js';

export class InMemoryPrivacyAuditRecorder implements AuditRecorder {
  private readonly events: AuditEvent[] = [];

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }
}
