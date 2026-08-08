import type { Clock } from '../../../shared/time/Clock.js';
import type { AuditLogRepository } from '../domain/ports/AuditLogRepository.js';
import type { AuditLogId } from '../domain/model/value-objects/AuditLogId.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { ActorType } from '../domain/model/ActorType.js';
import { AuditLog } from '../domain/model/aggregates/AuditLog.js';

export interface RecordAuditLogCommand {
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
}

export interface RecordAuditLogDeps {
  readonly auditLogs: AuditLogRepository;
  readonly clock: Clock;
  readonly generateAuditLogId: () => AuditLogId;
}

/**
 * The single write path for the `audit` module's own aggregate (design
 * §1 Application). Builds an `AuditLog` from a plain-string command and
 * persists it via `AuditLogRepository.save`, optionally joining the
 * caller's transaction so the audit row commits atomically with the
 * business write (design D-A5).
 */
export function createRecordAuditLogUseCase(deps: RecordAuditLogDeps) {
  return async function record(cmd: RecordAuditLogCommand, tx?: Transaction): Promise<AuditLog> {
    const log = AuditLog.create({
      id: deps.generateAuditLogId(),
      organizationId: cmd.organizationId,
      actorType: cmd.actorType,
      actorId: cmd.actorId,
      action: cmd.action,
      resource: cmd.resource,
      resourceId: cmd.resourceId,
      detail: cmd.detail,
      ipAddress: cmd.ipAddress,
      createdAt: deps.clock.now(),
    });

    await deps.auditLogs.save(log, tx);
    return log;
  };
}
