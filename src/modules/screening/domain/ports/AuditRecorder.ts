import type { Transaction } from './UnitOfWork.js';
import type { ActorType } from '../../../../shared/kernel/AuthContext.js';
import type { ScreeningAuditAction, ScreeningAuditResource } from '../model/value-objects/ScreeningAuditVocabulary.js';

/**
 * One audited event, typed with screening's OWN closed vocabulary (design
 * D5, exact twin of case-management's `AuditRecorder.ts`). `application`
 * code builds this and hands it to `AuditRecorder.record` — it never
 * touches the `audit` module directly (eslint `boundaries`: `application`
 * may only depend on its own module's `domain`).
 */
export interface AuditEvent {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: ScreeningAuditAction;
  readonly resource: ScreeningAuditResource;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

/**
 * Inverted port (mirrors case-management's `AuditRecorder`): screening's
 * `application` layer depends only on this port (its own module's
 * `domain`), never on the `audit` module. The composition root (`main.ts` +
 * `screeningAuditRecorderAdapter.ts`) is the ONLY place a concrete
 * implementation is constructed, bridging to the `audit` module's
 * `RecordAuditLog` use case.
 *
 * `tx` is screening's OWN opaque `Transaction` (this module's
 * `UnitOfWork.ts`) — threaded through `withTransaction` so the audit row
 * commits atomically with the business write.
 */
export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
