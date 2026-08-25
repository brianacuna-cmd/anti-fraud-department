import { z } from 'zod';
import type { AlertType } from '../../../../../domain/model/value-objects/AlertType.js';

/**
 * Wire↔domain casing map (design D2/D8): the HTTP wire values are lowercase
 * snake_case identifiers, the domain form is UPPER_SNAKE. Confined to the
 * HTTP layer — the domain never sees the wire form. Legacy Spanish wire
 * keys remain accepted on input so existing clients keep working.
 */
export const WIRE_TO_ALERT_TYPE = {
  case_assigned: 'CASE_ASSIGNED',
  sla_due_soon: 'SLA_DUE_SOON',
  approval_pending: 'APPROVAL_PENDING',
  critical_risk: 'CRITICAL_RISK',
  caso_asignado: 'CASE_ASSIGNED',
  sla_por_vencer: 'SLA_DUE_SOON',
  aprobacion_pendiente: 'APPROVAL_PENDING',
  riesgo_critico: 'CRITICAL_RISK',
} as const satisfies Record<string, AlertType>;

export type WireAlertType = keyof typeof WIRE_TO_ALERT_TYPE;

export const ALERT_TYPE_TO_WIRE: Record<AlertType, 'case_assigned' | 'sla_due_soon' | 'approval_pending' | 'critical_risk'> = {
  CASE_ASSIGNED: 'case_assigned',
  SLA_DUE_SOON: 'sla_due_soon',
  APPROVAL_PENDING: 'approval_pending',
  CRITICAL_RISK: 'critical_risk',
};

/** PUT /notifications/preferences/:alertType/:channel body. */
export const setPreferenceBodySchema = z.object({ enabled: z.boolean() }).strict();

export type SetPreferenceBody = z.infer<typeof setPreferenceBodySchema>;
