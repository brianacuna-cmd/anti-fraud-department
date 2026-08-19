import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type {
  EnforcementActionRepository,
  EnforcementActionListResult,
} from '../domain/ports/EnforcementActionRepository.js';
import type { EnforcementActionStatus } from '../domain/model/value-objects/EnforcementActionStatus.js';
import type { EnforcementActionType } from '../domain/model/value-objects/EnforcementActionType.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const ENFORCEMENT_READ_ROLES = ['SUPERVISOR', 'ADMIN', 'AUDITOR'] as const;

export interface ListEnforcementActionsInput {
  readonly auth: AuthContext;
  readonly status?: EnforcementActionStatus;
  readonly actionType?: EnforcementActionType;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly caseId?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface ListEnforcementActionsDeps {
  readonly enforcementActions: EnforcementActionRepository;
}

/**
 * GET /enforcement-actions — tenant-scoped, filtered, paginated history of
 * enforcement actions (requested / applied / rejected). Role-gated to
 * SUPERVISOR|ADMIN|AUDITOR (read-only oversight). Filter by entity
 * (`targetType`/`targetId`), `status`, `actionType`, or `caseId`.
 * Scope: enforcement_actions (read-only — no timeline/audit).
 */
export function createListEnforcementActionsUseCase(deps: ListEnforcementActionsDeps) {
  return async function listEnforcementActions(
    input: ListEnforcementActionsInput,
  ): Promise<EnforcementActionListResult> {
    requireRole(input.auth, ENFORCEMENT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    return deps.enforcementActions.list({
      organizationId,
      status: input.status,
      actionType: input.actionType,
      targetType: input.targetType,
      targetId: input.targetId,
      caseId: input.caseId,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
