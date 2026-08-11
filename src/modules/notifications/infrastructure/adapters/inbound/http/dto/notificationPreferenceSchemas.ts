import { z } from 'zod';
import type { AlertType } from '../../../../../domain/model/value-objects/AlertType.js';

/**
 * Wire↔domain casing map (design D2/D8): the HTTP wire values are lowercase
 * snake_case backlog identifiers, the domain form is UPPER_SNAKE. Confined
 * to the HTTP layer — the domain never sees the wire form. Single source of
 * truth for the router's path-param translation in both directions.
 */
export const WIRE_TO_ALERT_TYPE = {
  caso_asignado: 'CASO_ASIGNADO',
  sla_por_vencer: 'SLA_POR_VENCER',
  aprobacion_pendiente: 'APROBACION_PENDIENTE',
  riesgo_critico: 'RIESGO_CRITICO',
} as const satisfies Record<string, AlertType>;

export type WireAlertType = keyof typeof WIRE_TO_ALERT_TYPE;

export const ALERT_TYPE_TO_WIRE: Record<AlertType, WireAlertType> = {
  CASO_ASIGNADO: 'caso_asignado',
  SLA_POR_VENCER: 'sla_por_vencer',
  APROBACION_PENDIENTE: 'aprobacion_pendiente',
  RIESGO_CRITICO: 'riesgo_critico',
};

/** PUT /notifications/preferences/:alertType/:channel body. */
export const setPreferenceBodySchema = z.object({ enabled: z.boolean() }).strict();

export type SetPreferenceBody = z.infer<typeof setPreferenceBodySchema>;
