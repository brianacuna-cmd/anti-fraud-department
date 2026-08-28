import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { SarReport } from '../domain/model/aggregates/SarReport.js';
import type { SarReportRepository } from '../domain/ports/SarReportRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createSarReportId } from '../domain/model/value-objects/SarReportId.js';
import { forbiddenCrossTenant, sarReportNotFound } from '../domain/errors/SarError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SAR_WRITE_ROLES } from './authorization/policy.js';

export interface ApproveSarReportDraftInput {
  readonly auth: AuthContext;
  readonly sarReportId: string;
}

export interface ApproveSarReportDraftDeps {
  readonly reports: SarReportRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * SAR-002: `PATCH /sar-reports/:id/approve` — reviews, approves, and locks
 * a draft in one step, ahead of official filing (SAR-003/004). SUPERVISOR
 * only, four eyes (`SarReport.approve` rejects the drafter approving their
 * own report — see that method's doc for why the check lives there).
 */
export function createApproveSarReportDraftUseCase(deps: ApproveSarReportDraftDeps) {
  return async function approveSarReportDraft(input: ApproveSarReportDraftInput): Promise<SarReport> {
    requireOperationalRole(input.auth, SAR_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const sarReportId = createSarReportId(input.sarReportId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.reports.findById(sarReportId, tx);
      if (existing === null) {
        throw sarReportNotFound(sarReportId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('SAR report does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previousStatus = existing.status;
      const approved = existing.approve(input.auth.userId, now);

      await deps.reports.save(approved, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'APPROVE_SAR_REPORT',
          resource: 'sar_report',
          resourceId: approved.id,
          detail: { previousStatus, status: approved.status },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return approved;
    });
  };
}
