import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/** Code -> HTTP status for every closed `NotificationsErrorCode` (design D8a). */
export const notificationsErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_CROSS_TENANT: 403,
  UNKNOWN_ALERT_TYPE: 422,
  UNKNOWN_CHANNEL: 422,
};
