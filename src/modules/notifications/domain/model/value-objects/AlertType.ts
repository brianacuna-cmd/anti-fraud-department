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
  // Additive inbound aliases (PR1, notification-read-state): historically
  // used spellings normalized to the canonical catalog. Zero breaking
  // change — the canonical catalog itself is untouched.
  SLA_WARNING: 'SLA_DUE_SOON',
  CRITICAL_FRAUD: 'CRITICAL_RISK',
  APPROVAL_REQUIRED: 'APPROVAL_PENDING',
};

/**
 * Preferred legacy/reverse-lookup key per canonical value, for
 * `alertTypeStorageValues`. `SLA_DUE_SOON` and `CRITICAL_RISK` and
 * `APPROVAL_PENDING` now each have two legacy spellings (Spanish + the new
 * English alias); this keeps the reverse dual-read pair stable by always
 * preferring the original Spanish legacy spelling that existing stored
 * documents/tests rely on.
 */
const PREFERRED_LEGACY_ALERT_TYPE: Readonly<Record<AlertType, string>> = {
  CASE_ASSIGNED: 'CASO_ASIGNADO',
  SLA_DUE_SOON: 'SLA_POR_VENCER',
  APPROVAL_PENDING: 'APROBACION_PENDIENTE',
  CRITICAL_RISK: 'RIESGO_CRITICO',
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
  const legacy = PREFERRED_LEGACY_ALERT_TYPE[alertType];
  return [alertType, legacy ?? alertType];
}
