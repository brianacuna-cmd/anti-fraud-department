import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createEnforcementActionId } from '../domain/model/value-objects/EnforcementActionId.js';
import { enforcementActionNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';
import {
  executeEnforcementWithin,
  type EnforcementExecutionDeps,
  type EnforcementExecutionResult,
} from './enforcementExecution.js';

export interface ExecuteEnforcementActionInput {
  readonly auth: AuthContext;
  readonly enforcementActionId: string;
}

export type ExecuteEnforcementActionResult = EnforcementExecutionResult;

export interface ExecuteEnforcementActionDeps extends EnforcementExecutionDeps {
  readonly unitOfWork: UnitOfWork;
}

/**
 * Executes an enforcement action. SUPERVISOR only.
 *
 * Approval already executes the measure it authorizes, so this route is
 * only needed for REVIEW actions (no dual control) and for actions left
 * APPROVED because the tenant had no outbound webhook at approval time.
 * Non-REVIEW requires APPROVED. See `executeEnforcementWithin`. Case status
 * is never changed.
 */
export function createExecuteEnforcementActionUseCase(deps: ExecuteEnforcementActionDeps) {
  return async function executeEnforcementAction(
    input: ExecuteEnforcementActionInput,
  ): Promise<ExecuteEnforcementActionResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const enforcementActionId = createEnforcementActionId(input.enforcementActionId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.enforcementActions.findById(enforcementActionId, tx);
      if (existing === null) {
        throw enforcementActionNotFound(enforcementActionId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('enforcement action does not belong to the actor organization');
      }
      return executeEnforcementWithin(deps, existing, input.auth, tx);
    });
  };
}
