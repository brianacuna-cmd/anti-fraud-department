import type { AuditEvent, AuditRecorder } from '../modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction as ScreeningTransaction } from '../modules/screening/domain/ports/UnitOfWork.js';
import type { createRecordAuditLogUseCase } from '../modules/audit/application/RecordAuditLog.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';

/**
 * Composition-root bridge (design D6, exact twin of
 * `caseManagementAuditRecorderAdapter.ts`): implements screening's OWN
 * `AuditRecorder` port by delegating to the `audit` module's
 * `RecordAuditLog` use case. This file lives OUTSIDE every module's
 * `domain`/`application`/`infrastructure` folders (like `main.ts` itself) —
 * it is the one legal seam where a cross-module import (screening's port
 * depending on the audit module's use case) is allowed by
 * `eslint-plugin-boundaries`.
 *
 * `tx` is screening's OWN opaque `Transaction`; `recordAuditLog` wants the
 * `audit` module's OWN opaque `Transaction`. Both are the same runtime
 * `ClientSession` — this is the single documented cast that bridges the two
 * nominal types for this module, mirroring the case-management precedent.
 */
export function createScreeningAuditRecorderAdapter(
  recordAuditLog: ReturnType<typeof createRecordAuditLogUseCase>,
): AuditRecorder {
  return {
    async record(event: AuditEvent, tx?: ScreeningTransaction): Promise<void> {
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
