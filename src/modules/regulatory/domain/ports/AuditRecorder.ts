import type { Transaction } from './UnitOfWork.js';
import type { ActorType } from '../../../../shared/kernel/AuthContext.js';
import type {
  RegulatoryAuditAction,
  RegulatoryAuditResource,
} from '../model/value-objects/RegulatoryAuditVocabulary.js';

export interface AuditEvent {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: RegulatoryAuditAction;
  readonly resource: RegulatoryAuditResource;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

export interface AuditRecorder {
  record(event: AuditEvent, tx?: Transaction): Promise<void>;
}
