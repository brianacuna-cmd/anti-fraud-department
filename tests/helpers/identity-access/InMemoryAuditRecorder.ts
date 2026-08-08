import type { AuditEvent, AuditRecorder } from '../../../src/modules/identity-access/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/identity-access/domain/ports/UnitOfWork.js';

/**
 * In-memory `AuditRecorder` fake (design "Testing Strategy" — each
 * retrofitted use case is tested against this, asserting exactly one
 * `record` call with the expected action/resource/detail/ipAddress).
 * Captures every recorded event, plus whether a `tx` was passed, so tests
 * can assert atomic emission threads the caller's transaction.
 */
export class InMemoryAuditRecorder implements AuditRecorder {
  private readonly events: Array<{ event: AuditEvent; tx: Transaction | undefined }> = [];

  async record(event: AuditEvent, tx?: Transaction): Promise<void> {
    this.events.push({ event, tx });
  }

  all(): readonly AuditEvent[] {
    return this.events.map((entry) => entry.event);
  }

  calls(): ReadonlyArray<{ event: AuditEvent; tx: Transaction | undefined }> {
    return this.events;
  }
}
