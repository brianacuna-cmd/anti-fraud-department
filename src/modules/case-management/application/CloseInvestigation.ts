import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createInvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { investigationNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface CloseInvestigationInput {
  readonly auth: AuthContext;
  readonly investigationId: string;
  readonly findings: string;
}

export interface CloseInvestigationDeps {
  readonly investigations: InvestigationRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * Closes an investigation (OPEN -> CLOSED) recording findings. Any
 * authenticated tenant actor; the investigation must belong to the actor's
 * org. Closing an already-CLOSED one throws `invalidTransition` (422). Within
 * ONE transaction: persist + CLOSE_INVESTIGATION audit.
 */
export function createCloseInvestigationUseCase(deps: CloseInvestigationDeps) {
  return async function closeInvestigation(input: CloseInvestigationInput): Promise<Investigation> {
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
      const closed = existing.close(input.findings, now);
      await deps.investigations.save(closed, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'CLOSE_INVESTIGATION',
          resource: 'investigation',
          resourceId: closed.id,
          detail: { caseId: closed.caseId, findings: closed.findings },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return closed;
    });
  };
}
