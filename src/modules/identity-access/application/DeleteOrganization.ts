import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Organization } from '../domain/model/aggregates/Organization.js';
import type { createTransitionOrganizationStatusUseCase } from './TransitionOrganizationStatus.js';

export interface DeleteOrganizationInput {
  readonly auth: AuthContext;
  readonly organizationId: string;
}

export interface DeleteOrganizationDeps {
  readonly transitionOrganizationStatus: ReturnType<typeof createTransitionOrganizationStatusUseCase>;
}

/**
 * HTTP sugar (organization-lifecycle spec: "Soft Delete as Status
 * Transition"). Calls the exact same use case as `/transition` with
 * `next=DESHABILITADO` — never a parallel implementation, so results and
 * errors are byte-for-byte identical by construction.
 */
export function createDeleteOrganizationUseCase(deps: DeleteOrganizationDeps) {
  return async function deleteOrganization(input: DeleteOrganizationInput): Promise<Organization> {
    return deps.transitionOrganizationStatus({
      auth: input.auth,
      organizationId: input.organizationId,
      next: 'DESHABILITADO',
    });
  };
}
