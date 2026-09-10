import type { Transaction } from './UnitOfWork.js';
import type { ActorType } from '../../../../shared/kernel/AuthContext.js';
import type {
  PrivacyAuditAction,
  PrivacyAuditResource,
} from '../model/value-objects/PrivacyAuditVocabulary.js';

/**
 * One audited event, typed with privacy's OWN closed vocabulary. Application
 * never touches the `audit` module directly (eslint `boundaries`).
 */
export interface AuditEvent {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: PrivacyAuditAction;
  readonly resource: PrivacyAuditResource;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
