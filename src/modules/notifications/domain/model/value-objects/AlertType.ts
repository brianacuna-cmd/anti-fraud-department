import { unknownAlertType } from '../../errors/NotificationsError.js';

/**
 * Closed catalog of exactly the four product-confirmed alert types (design
 * D2, authoritative — NOT a placeholder). Not branded (like `ActorType`) — a
 * closed enum, not an opaque id.
 *
 * Wire↔domain casing: the HTTP wire values are lowercase snake_case
 * identifiers (`case_assigned`, ...); these UPPER_SNAKE constants are the
 * domain form. The bidirectional casing map lives in the HTTP layer only
 * (design D2/D8), never here. Legacy Spanish stored/wire values are accepted
 * by `createAlertType` and normalized to this catalog.
 */
export type AlertType = 'CASE_ASSIGNED' | 'SLA_DUE_SOON' | 'APPROVAL_PENDING' | 'CRITICAL_RISK';

/** Single source of truth for the GET matrix loop and the HTTP wire mapping (design D2/D7). */
export const ALERT_TYPES = ['CASE_ASSIGNED', 'SLA_DUE_SOON', 'APPROVAL_PENDING', 'CRITICAL_RISK'] as const;

const LEGACY_ALERT_TYPE_TO_CANONICAL: Readonly<Record<string, AlertType>> = {
  CASO_ASIGNADO: 'CASE_ASSIGNED',
  SLA_POR_VENCER: 'SLA_DUE_SOON',
  APROBACION_PENDIENTE: 'APPROVAL_PENDING',
  RIESGO_CRITICO: 'CRITICAL_RISK',
};

const VALID_ALERT_TYPES: ReadonlySet<string> = new Set<AlertType>(ALERT_TYPES);

export function createAlertType(value: string): AlertType {
  if (VALID_ALERT_TYPES.has(value)) {
    return value as AlertType;
  }
  const canonical = LEGACY_ALERT_TYPE_TO_CANONICAL[value];
  if (canonical !== undefined) {
    return canonical;
  }
  throw unknownAlertType(value);
}

/** English stored value plus the legacy Spanish value, for dual-read Mongo filters. */
export function alertTypeStorageValues(alertType: AlertType): readonly [AlertType, string] {
  const legacy = Object.entries(LEGACY_ALERT_TYPE_TO_CANONICAL).find(([, canonical]) => canonical === alertType)?.[0];
  return [alertType, legacy ?? alertType];
}
