import type { Transaction } from './UnitOfWork.js';
import type { ActorType } from '../../../../shared/kernel/AuthContext.js';
import type {
  CaseManagementAuditAction,
  CaseManagementAuditResource,
} from '../model/value-objects/CaseManagementAuditVocabulary.js';

/**
 * One audited event, typed with case-management's OWN closed vocabulary
 * (design "Cross-module seams: Audit reuse"). `application` code builds
 * this and hands it to `AuditRecorder.record` — it never touches the
 * `audit` module directly (eslint `boundaries`: `application` may only
 * depend on its own module's `domain`).
 */
export interface AuditEvent {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: CaseManagementAuditAction;
  readonly resource: CaseManagementAuditResource;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

/**
 * Inverted port (mirrors identity-access's `AuditRecorder` — design D-A2
 * twin): case-management's `application` layer depends only on this port
 * (its own module's `domain`), never on the `audit` module. The
 * composition root (`main.ts` + `caseManagementAuditRecorderAdapter.ts`) is
 * the ONLY place a concrete implementation is constructed, bridging to the
 * `audit` module's `RecordAuditLog` use case.
 *
 * `tx` is case-management's OWN opaque `Transaction` (this module's
 * `UnitOfWork.ts`) — threaded through `withTransaction` so the audit row
 * commits atomically with the business write (design: "Transactional
 * atomicity across all mutating use cases").
 */
export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
