import type { AuditEvent, AuditRecorder } from '../../../src/modules/notifications/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../src/modules/notifications/domain/ports/UnitOfWork.js';

/**
 * In-memory `AuditRecorder` fake (modeled on identity-access's
 * `InMemoryAuditRecorder`). Captures every recorded event, plus whether a
 * `tx` was passed, so tests can assert atomic emission threads the caller's
 * transaction. Can be configured to reject, simulating a mid-transaction
 * audit-write failure.
 */
export class InMemoryAuditRecorder implements AuditRecorder {
  private readonly events: Array<{ event: AuditEvent; tx: Transaction | undefined }> = [];
  private failure: Error | null = null;

  async record(event: AuditEvent, tx?: Transaction): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.events.push({ event, tx });
  }

  all(): readonly AuditEvent[] {
    return this.events.map((entry) => entry.event);
  }

  calls(): ReadonlyArray<{ event: AuditEvent; tx: Transaction | undefined }> {
    return this.events;
  }

  /** Test-only: forces the next (and every subsequent) `record` call to reject. */
  forceFailure(error: Error): void {
    this.failure = error;
  }
}
