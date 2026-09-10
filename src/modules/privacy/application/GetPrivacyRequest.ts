import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { PrivacyDataRequest } from '../domain/model/aggregates/PrivacyDataRequest.js';
import type { PrivacyDataRequestId } from '../domain/model/value-objects/PrivacyDataRequestId.js';
import type { PrivacyDataRequestRepository } from '../domain/ports/PrivacyDataRequestRepository.js';
import { privacyRequestNotFound } from '../domain/errors/PrivacyError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export function createGetPrivacyRequestUseCase(deps: {
  readonly requests: PrivacyDataRequestRepository;
}) {
  return async function getPrivacyRequest(input: {
    readonly auth: AuthContext;
    readonly requestId: PrivacyDataRequestId;
  }): Promise<PrivacyDataRequest> {
    const organizationId = requireTenantContext(input.auth);
    const request = await deps.requests.findById(input.requestId);
    // Same 404 for "does not exist" and "belongs to another tenant": telling
    // them apart would confirm the existence of another tenant's row.
    if (request === null || request.organizationId !== organizationId) {
      throw privacyRequestNotFound(input.requestId);
    }
    return request;
  };
}
