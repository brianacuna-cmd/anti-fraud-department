import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

export type InvestigationStatusTarget = 'INVESTIGATING' | 'RESOLVED';

export interface UpdateInvestigationStatusInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly status: InvestigationStatusTarget;
}

export interface UpdateInvestigationStatusDeps {
  readonly investigations: InvestigationRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * PATCH /investigations/:id/status — advances an investigation to INVESTIGATING
 * or RESOLVED (OPEN -> INVESTIGATING, OPEN|INVESTIGATING -> RESOLVED). Any
 * authenticated tenant actor; the investigation must belong to the actor's org.
 * An illegal edge throws `invalidTransition` (422). Within ONE transaction:
 * persist + UPDATE_INVESTIGATION_STATUS audit. Scope: investigations, audit_logs.
 */
export function createUpdateInvestigationStatusUseCase(deps: UpdateInvestigationStatusDeps) {
  return async function updateInvestigationStatus(
    input: UpdateInvestigationStatusInput,
  ): Promise<Investigation> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const investigationId = createInvestigationId(input.investigationId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.investigations.findById(investigationId, tx);
      if (existing === null) {
        throw investigationNotFound(investigationId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('investigation does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previousStatus = existing.status;
      const updated = existing.changeStatus(input.status, now);
      await deps.investigations.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_INVESTIGATION_STATUS',
          resource: 'investigation',
          resourceId: updated.id,
          detail: { caseId: updated.caseId, previousStatus, newStatus: updated.status },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
