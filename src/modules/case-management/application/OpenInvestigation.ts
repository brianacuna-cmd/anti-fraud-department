import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Investigation } from '../domain/model/aggregates/Investigation.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { InvestigationRepository } from '../domain/ports/InvestigationRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { InvestigationId } from '../domain/model/value-objects/InvestigationId.js';
import { Investigation as InvestigationAggregate } from '../domain/model/aggregates/Investigation.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { createInvestigationSubjectType } from '../domain/model/value-objects/InvestigationSubjectType.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { assertAssigned } from '../domain/services/AssignmentGate.js';
import { assertNotClosed } from '../domain/services/ClosedCaseGate.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';

export interface OpenInvestigationInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly subjectType: string;
  readonly subjectId: string;
}

export interface OpenInvestigationDeps {
  readonly cases: CaseRepository;
  readonly investigations: InvestigationRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateInvestigationId: () => InvestigationId;
}

/**
 * Opens an investigation into one entity (WALLET|EMAIL|CUSTOMER) on a case.
 * Any authenticated tenant actor may open one; the case must exist, belong to
 * the actor's org, and not be soft-deleted. Within ONE transaction: persist
 * the investigation + an OPEN_INVESTIGATION audit row (no timeline event — the
 * closed TimelineEventType catalog has no investigation type).
 */
export function createOpenInvestigationUseCase(deps: OpenInvestigationDeps) {
  return async function openInvestigation(input: OpenInvestigationInput): Promise<Investigation> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const caseId = createCaseId(input.caseId);
    const subjectType = createInvestigationSubjectType(input.subjectType);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = await deps.cases.findById(caseId, tx);
      if (kase === null || kase.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (kase.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }
      // Without an assignee the case is frozen. See `AssignmentGate`.
      assertAssigned(kase);
      // A closed case is not worked. See `ClosedCaseGate`.
      assertNotClosed(kase);

      const now = deps.clock.now();
      const investigation = InvestigationAggregate.open({
        id: deps.generateInvestigationId(),
        caseId,
        organizationId,
        subjectType,
        subjectId: input.subjectId,
        openedBy: input.auth.userId,
        now,
      });
      await deps.investigations.save(investigation, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'OPEN_INVESTIGATION',
          resource: 'investigation',
          resourceId: investigation.id,
          detail: { caseId, subjectType, subjectId: investigation.subjectId },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return investigation;
    });
  };
}
