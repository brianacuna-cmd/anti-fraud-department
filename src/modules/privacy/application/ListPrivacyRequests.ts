import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { PrivacyRequestStatus } from '../domain/model/value-objects/PrivacyRequestStatus.js';
import type { PrivacyRequestType } from '../domain/model/value-objects/PrivacyRequestType.js';
import type {
  PrivacyDataRequestListResult,
  PrivacyDataRequestRepository,
} from '../domain/ports/PrivacyDataRequestRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListPrivacyRequestsInput {
  readonly auth: AuthContext;
  readonly status?: readonly PrivacyRequestStatus[];
  readonly type?: readonly PrivacyRequestType[];
  readonly limit: number;
  readonly offset: number;
}

/**
 * The compliance officer's inbox.
 *
 * No role check beyond the tenant: reading the queue is exactly what the
 * governance plane (ADMIN, AUDITOR, ORGANIZATION) exists to do, and a
 * deadline nobody outside the operator can see is a deadline nobody
 * supervises.
 */
export function createListPrivacyRequestsUseCase(deps: {
  readonly requests: PrivacyDataRequestRepository;
}) {
  return async function listPrivacyRequests(
    input: ListPrivacyRequestsInput,
  ): Promise<PrivacyDataRequestListResult> {
    const organizationId = requireTenantContext(input.auth);
    return deps.requests.list({
      organizationId,
      status: input.status,
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
  };
}
