import type { Transaction } from './UnitOfWork.js';
import type { ActorType } from '../../../../shared/kernel/AuthContext.js';
import type { SarAuditAction, SarAuditResource } from '../model/value-objects/SarAuditVocabulary.js';

/**
 * One audited event, typed with sar's OWN closed vocabulary. Application
 * never touches the `audit` module directly (eslint `boundaries`).
 */
export interface AuditEvent {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: SarAuditAction;
  readonly resource: SarAuditResource;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
