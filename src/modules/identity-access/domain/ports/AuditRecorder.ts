import type { Transaction } from './UnitOfWork.js';
import type { IdentityAccessAuditAction, IdentityAccessAuditResource } from '../model/value-objects/AuditVocabulary.js';
import type { ActorType } from '../model/value-objects/ActorType.js';

/**
 * One audited event, typed with identity-access's OWN closed vocabulary
 * (design §2/§5). `application` code builds this and hands it to
 * `AuditRecorder.record` — it never touches the `audit` module directly
 * (eslint `boundaries`: `application` may only depend on its own module's
 * `domain`).
 */
export interface AuditEvent {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  /** `null` for a failed login against an unknown email/organization (no actor resolved). */
  readonly actorId: string | null;
  readonly action: IdentityAccessAuditAction;
  readonly resource: IdentityAccessAuditResource;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

/**
 * Inverted port (design D-A2) — same dependency-inversion precedent as
 * `PasswordHasher`/`Clock`: identity-access's `application` layer depends
 * only on this port (its own module's `domain`), never on the `audit`
 * module. The composition root (`main.ts`) is the ONLY place a concrete
 * implementation is constructed, bridging to the `audit` module's
 * `RecordAuditLog` use case (design D-A4).
 *
 * `tx` is identity-access's OWN opaque `Transaction` (this module's
 * `UnitOfWork.ts`) — the same marker every retrofitted use case already
 * threads through `withTransaction`. Callers pass it so the audit row
 * commits atomically with the business write (design D-A5); the login path
 * (no transaction, design "Login atomicity caveat") omits it.
 */
export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
