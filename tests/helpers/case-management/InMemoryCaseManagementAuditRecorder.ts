import type { AuditEvent, AuditRecorder } from '../../../src/modules/case-management/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory `AuditRecorder` fake for case-management (mirrors `InMemoryAuditRecorder`). */
export class InMemoryCaseManagementAuditRecorder implements AuditRecorder {
  private readonly events: Array<{ event: AuditEvent; tx: Transaction | undefined }> = [];

  async record(event: AuditEvent, tx?: Transaction): Promise<void> {
    this.events.push({ event, tx });
  }

  all(): readonly AuditEvent[] {
    return this.events.map((entry) => entry.event);
  }
}
