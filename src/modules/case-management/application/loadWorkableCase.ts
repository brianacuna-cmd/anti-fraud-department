import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { assertAssigned } from '../domain/services/AssignmentGate.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

/**
 * Shared preamble of the status-moving use cases: tenant scope, the case
 * exists and is not soft-deleted, it belongs to the actor's organization, and
 * it has an assignee (`AssignmentGate`). Role checks stay in each use case,
 * because they differ.
 */
export async function loadWorkableCase(
  cases: CaseRepository,
  input: { readonly auth: AuthContext; readonly caseId: string },
  tx: Transaction,
): Promise<{ readonly existing: Case; readonly organizationId: string }> {
  const organizationId = requireTenantContext(input.auth);
  const caseId = createCaseId(input.caseId);
  const existing = await cases.findById(caseId, tx);
  if (existing === null || existing.deletedAt !== null) {
    throw caseNotFound(caseId);
  }
  if (existing.organizationId !== organizationId) {
    throw forbiddenCrossTenant('case does not belong to the actor organization');
  }
  assertAssigned(existing);
  return { existing, organizationId };
}
