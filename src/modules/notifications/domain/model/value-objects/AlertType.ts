import { unknownAlertType } from '../../errors/NotificationsError.js';

/**
 * Closed catalog of exactly the four product-confirmed alert types (design
 * D2, authoritative — NOT a placeholder). Not branded (like `ActorType`) — a
 * closed enum, not an opaque id.
 *
 * Wire↔domain casing: the HTTP wire values are lowercase snake_case backlog
 * identifiers (`caso_asignado`, ...); these UPPER_SNAKE constants are the
 * domain form. The bidirectional casing map lives in the HTTP layer only
 * (design D2/D8), never here.
 */
export type AlertType = 'CASO_ASIGNADO' | 'SLA_POR_VENCER' | 'APROBACION_PENDIENTE' | 'RIESGO_CRITICO';

/** Single source of truth for the GET matrix loop and the HTTP wire mapping (design D2/D7). */
export const ALERT_TYPES = ['CASO_ASIGNADO', 'SLA_POR_VENCER', 'APROBACION_PENDIENTE', 'RIESGO_CRITICO'] as const;

const VALID_ALERT_TYPES: ReadonlySet<string> = new Set<AlertType>(ALERT_TYPES);

export function createAlertType(value: string): AlertType {
  if (!VALID_ALERT_TYPES.has(value)) {
    throw unknownAlertType(value);
  }
  return value as AlertType;
}
