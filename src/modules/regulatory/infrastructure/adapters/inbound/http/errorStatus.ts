import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/** Código -> estado HTTP para cada `RegulatoryErrorCode`. */
export const regulatoryErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_CROSS_TENANT: 403,
  FORBIDDEN_ROLE: 403,
  REGULATORY_REPORT_NOT_FOUND: 404,
  // 409 y no 403: la petición está bien formada y autorizada; choca con un
  // documento que ya salió del edificio.
  REPORT_ALREADY_ISSUED: 409,
  // 400: el periodo es parte de la petición y quien la envió puede corregirlo.
  INVALID_REPORTING_PERIOD: 400,
};
