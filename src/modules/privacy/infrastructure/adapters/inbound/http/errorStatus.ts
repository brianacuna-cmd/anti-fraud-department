import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/** Code -> HTTP status for every closed `PrivacyErrorCode` (mirrors `sarErrorStatus`). */
export const privacyErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_CROSS_TENANT: 403,
  FORBIDDEN_ROLE: 403,
  PRIVACY_REQUEST_NOT_FOUND: 404,
  INVALID_TRANSITION: 422,
  // 409 and not 403: the request is authorized and well formed — it conflicts
  // with a duty that will expire. The subject can lawfully ask again later,
  // and a 403 would suggest they never can.
  ERASURE_BARRED_BY_RETENTION: 409,
};
