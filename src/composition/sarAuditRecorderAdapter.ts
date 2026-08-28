import type { AuditEvent, AuditRecorder } from '../modules/sar/domain/ports/AuditRecorder.js';
import type { Transaction as SarTransaction } from '../modules/sar/domain/ports/UnitOfWork.js';
import type { createRecordAuditLogUseCase } from '../modules/audit/application/RecordAuditLog.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';

/**
 * Composition-root bridge (exact twin of `riskAssessmentAuditRecorderAdapter.ts`):
 * implements sar's OWN `AuditRecorder` port by delegating to the `audit`
 * module's `RecordAuditLog` use case. This file lives OUTSIDE every
 * module's `domain`/`application`/`infrastructure` folders — the one legal
 * seam where a cross-module import is allowed by `eslint-plugin-boundaries`.
 *
 * `tx` is sar's OWN opaque `Transaction`; `recordAuditLog` wants the
 * `audit` module's OWN opaque `Transaction`. Both are the same runtime
 * `ClientSession` — this is the single documented cast that bridges the two
 * nominal types for this module.
 */
export function createSarAuditRecorderAdapter(
  recordAuditLog: ReturnType<typeof createRecordAuditLogUseCase>,
): AuditRecorder {
  return {
    async record(event: AuditEvent, tx?: SarTransaction): Promise<void> {
      await recordAuditLog(
        {
          organizationId: event.organizationId,
          actorType: event.actorType,
          actorId: event.actorId,
          action: event.action,
          resource: event.resource,
          resourceId: event.resourceId,
          detail: event.detail,
          ipAddress: event.ipAddress,
        },
        tx as unknown as AuditTransaction | undefined,
      );
    },
  };
}
