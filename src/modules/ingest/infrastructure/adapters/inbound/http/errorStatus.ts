import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/**
 * Code -> HTTP status for every closed `IngestErrorCode` (design D7).
 * Lives in the HTTP layer, never on the domain error itself.
 */
export const ingestErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_CROSS_TENANT: 403,
  FORBIDDEN_ROLE: 403,
  WEBHOOK_SIGNATURE_INVALID: 401,
  WEBHOOK_SECRET_NOT_FOUND: 401,
};
