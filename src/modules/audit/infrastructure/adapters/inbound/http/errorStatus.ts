import type { StatusByCode } from '../../../../../../shared/http/errorHandler.js';

/** Código -> estado HTTP para cada `AuditErrorCode`. */
export const auditErrorStatus: StatusByCode = {
  INVARIANT_VIOLATION: 400,
  FORBIDDEN_ROLE: 403,
  FORBIDDEN_CROSS_TENANT: 403,
  /*
   * 503 y no 500: falta una pieza de CONFIGURACIÓN, no hay un fallo del
   * programa. Un 500 mandaría a alguien a leer trazas de error que no existen;
   * un 503 dice que el servicio no está disponible todavía, que es la verdad
   * mientras nadie configure la clave de firma.
   */
  AUDIT_SIGNING_UNAVAILABLE: 503,
};
