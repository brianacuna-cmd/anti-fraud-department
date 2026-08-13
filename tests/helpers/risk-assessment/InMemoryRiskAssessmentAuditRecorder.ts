import type { AuditEvent, AuditRecorder } from '../../../src/modules/risk-assessment/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/risk-assessment/domain/ports/UnitOfWork.js';

/** In-memory `AuditRecorder` fake for risk-assessment (mirrors case-management). */
export class InMemoryRiskAssessmentAuditRecorder implements AuditRecorder {
  private readonly events: Array<{ event: AuditEvent; tx: Transaction | undefined }> = [];

  async record(event: AuditEvent, tx?: Transaction): Promise<void> {
    this.events.push({ event, tx });
  }

  all(): readonly AuditEvent[] {
    return this.events.map((entry) => entry.event);
  }
}
