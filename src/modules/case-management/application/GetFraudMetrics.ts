import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type {
  FraudMetricsReader,
  FraudMetricsSnapshot,
} from '../domain/ports/FraudMetricsReader.js';
import { createAssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { OVERSIGHT_READ_ROLES, requireReadRole } from './authorization/policy.js';

/**
 * Ventana por defecto y tope duro.
 *
 * El tope no es cosmetico: `flow` devuelve un punto por dia, asi que una
 * ventana sin limite convierte una peticion del panel en una respuesta
 * arbitrariamente grande y en un barrido completo de `cases`.
 */
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 365;

export interface GetFraudMetricsInput {
  readonly auth: AuthContext;
  readonly windowDays?: number;
}

export interface GetFraudMetricsDeps {
  readonly metrics: FraudMetricsReader;
  readonly clock: Clock;
  /** Solo para poner nombre a las barras de `workload`. */
  readonly assignees: AssigneeDirectory;
}

/**
 * GET /metrics/overview — la foto agregada que alimenta el panel de gobierno.
 *
 * Guarda de LECTURA (`OVERSIGHT_READ_ROLES` + el actor ORGANIZATION): es
 * justo lo que el plano de gobierno —ADMIN, AUDITOR y la organizacion— si
 * puede hacer, ahora que no opera sobre expedientes. El ANALYST queda fuera
 * a proposito: trabaja su bandeja, no la metrica del departamento.
 */
export function createGetFraudMetricsUseCase(deps: GetFraudMetricsDeps) {
  return async function getFraudMetrics(
    input: GetFraudMetricsInput,
  ): Promise<FraudMetricsSnapshot> {
    requireReadRole(input.auth, OVERSIGHT_READ_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const windowDays = input.windowDays ?? DEFAULT_WINDOW_DAYS;

    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > MAX_WINDOW_DAYS) {
      throw invariantViolation(`windowDays must be an integer between 1 and ${MAX_WINDOW_DAYS}`, {
        field: 'windowDays',
        value: windowDays,
      });
    }

    const snapshot = await deps.metrics.snapshot({
      organizationId,
      windowDays,
      now: deps.clock.now(),
    });

    return { ...snapshot, workload: await withNames(deps, organizationId, snapshot.workload) };
  };
}

/**
 * Pone nombre a los responsables.
 *
 * El lado de lectura solo conoce el id que hay guardado en `cases`, asi que
 * la barra se rotulaba con un ObjectId en hexadecimal — inservible para saber
 * quien tiene los expedientes encima. Un id que no resuelva (usuario borrado,
 * rol retirado) se queda sin nombre y la interfaz decide como rotularlo: es
 * preferible a inventarse uno.
 *
 * Si el directorio falla, el panel sale sin nombres en vez de no salir: la
 * carga de trabajo sigue siendo legible por los numeros.
 */
async function withNames(
  deps: GetFraudMetricsDeps,
  organizationId: string,
  workload: FraudMetricsSnapshot['workload'],
): Promise<FraudMetricsSnapshot['workload']> {
  if (workload.length === 0) {
    return workload;
  }

  let names: ReadonlyMap<string, string>;
  try {
    names = await deps.assignees.displayNames(
      organizationId,
      workload.map((entry) =>
        createAssignedTo(entry.assigneeType === 'ROLE' ? 'ROLE' : 'USER', entry.assigneeId),
      ),
    );
  } catch {
    return workload;
  }

  return workload.map((entry) => ({ ...entry, assigneeName: names.get(entry.assigneeId) ?? null }));
}
