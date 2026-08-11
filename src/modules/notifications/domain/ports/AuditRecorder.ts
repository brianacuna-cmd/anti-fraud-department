import type { Transaction } from './UnitOfWork.js';
import type { NotificationsAuditAction, NotificationsAuditResource } from '../model/value-objects/NotificationsAuditVocabulary.js';
import type { ActorType } from '../model/value-objects/ActorType.js';

/**
 * One audited event, typed with notifications' OWN closed vocabulary (design
 * D3). `application` code builds this and hands it to `AuditRecorder.record`
 * — it never touches the `audit` module directly (eslint `boundaries`:
 * `application` may only depend on its own module's `domain`).
 */
export interface AuditEvent {
  /** Always tenant-scoped here (never null — every use case requires an organization context, design D6). */
  readonly organizationId: string;
  readonly actorType: ActorType;
  /** `auth.userId` — never null for USER self-service. */
  readonly actorId: string;
  readonly action: NotificationsAuditAction;
  readonly resource: NotificationsAuditResource;
  /** The composite key string `${alertType}:${channel}`. */
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

/**
 * Inverted port (design D3/D12) — same dependency-inversion precedent as
 * identity-access's `AuditRecorder`: notifications' `application` layer
 * depends only on this port (its own module's `domain`), never on the
 * `audit` module. The composition root (`main.ts`) is the ONLY place a
 * concrete implementation is constructed, bridging to the `audit` module's
 * `RecordAuditLog` use case via `src/composition/notificationsAuditRecorderAdapter.ts`.
 */
export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
