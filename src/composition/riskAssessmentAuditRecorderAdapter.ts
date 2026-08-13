import type { AuditEvent, AuditRecorder } from '../modules/risk-assessment/domain/ports/AuditRecorder.js';
import type { Transaction as RiskAssessmentTransaction } from '../modules/risk-assessment/domain/ports/UnitOfWork.js';
import type { createRecordAuditLogUseCase } from '../modules/audit/application/RecordAuditLog.js';
import type { Transaction as AuditTransaction } from '../modules/audit/domain/ports/UnitOfWork.js';

/**
 * Composition-root bridge (design "Cross-module seams: Audit reuse", exact
 * twin of `caseManagementAuditRecorderAdapter.ts`): implements
 * risk-assessment's OWN `AuditRecorder` port by delegating to the `audit`
 * module's `RecordAuditLog` use case. This file lives OUTSIDE every
 * module's `domain`/`application`/`infrastructure` folders — it is the one
 * legal seam where a cross-module import is allowed by
 * `eslint-plugin-boundaries`.
 *
 * `tx` is risk-assessment's OWN opaque `Transaction`; `recordAuditLog` wants
 * the `audit` module's OWN opaque `Transaction`. Both are the same runtime
 * `ClientSession` — this is the single documented cast that bridges the two
 * nominal types for this module.
 */
export function createRiskAssessmentAuditRecorderAdapter(
  recordAuditLog: ReturnType<typeof createRecordAuditLogUseCase>,
): AuditRecorder {
  return {
    async record(event: AuditEvent, tx?: RiskAssessmentTransaction): Promise<void> {
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
