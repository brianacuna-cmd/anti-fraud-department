import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface UpdateInvestigationFindingsInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly findings: Record<string, unknown>;
  readonly explorationDepth: number;
}

export interface UpdateInvestigationFindingsDeps {
  readonly investigations: InvestigationRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * PATCH /investigations/:id/findings. Updates the structured JSON findings and
 * the exploration depth (`profundidad_explorada`) of the investigated network.
 * Any authenticated tenant actor; the investigation must belong to the actor's
 * org. Within ONE transaction: persist + UPDATE_INVESTIGATION_FINDINGS audit.
 * Scope (design "findings tables"): investigations, audit_logs.
 */
export function createUpdateInvestigationFindingsUseCase(deps: UpdateInvestigationFindingsDeps) {
  return async function updateInvestigationFindings(
    input: UpdateInvestigationFindingsInput,
  ): Promise<Investigation> {
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
      const updated = existing.recordFindings(input.findings, input.explorationDepth, now);
      await deps.investigations.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_INVESTIGATION_FINDINGS',
          resource: 'investigation',
          resourceId: updated.id,
          detail: {
            caseId: updated.caseId,
            explorationDepth: updated.explorationDepth,
            findingsKeys: Object.keys(input.findings),
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
