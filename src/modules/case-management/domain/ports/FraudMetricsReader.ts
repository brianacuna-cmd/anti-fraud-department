import type { Instant } from '../../../../shared/time/Instant.js';

/**
 * Serie diaria de entradas y cierres. Un solo punto por dia natural UTC,
 * incluidos los dias sin movimiento: una serie con huecos se dibuja como una
 * linea que salta en el tiempo y miente sobre la pendiente.
 */
export interface DailyCaseFlowPoint {
  /** Dia UTC en formato `YYYY-MM-DD`. */
  readonly date: string;
  readonly opened: number;
  readonly resolved: number;
}

/** Casos abiertos por responsable, para ver donde se acumula el trabajo. */
export interface AssigneeWorkload {
  readonly assigneeId: string;
  readonly assigneeType: string;
  /**
   * Nombre legible, resuelto por `GetFraudMetrics` contra el directorio de
   * asignatarios. Ausente en lo que devuelve el lector —solo conoce ids— y
   * `null` cuando el id ya no resuelve (usuario borrado, rol retirado).
   */
  readonly assigneeName?: string | null;
  readonly open: number;
  readonly overdue: number;
}

export interface RiskBucket {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

/**
 * Foto agregada del inquilino para el panel de gobierno.
 *
 * Todo son conteos ya agregados: el panel es de solo lectura y quien lo mira
 * no debe poder deducir de el ningun expediente concreto.
 */
export interface FraudMetricsSnapshot {
  readonly generatedAt: Instant;
  readonly windowDays: number;
  readonly cases: {
    readonly total: number;
    readonly byStatus: Readonly<Record<string, number>>;
    readonly byPriority: Readonly<Record<string, number>>;
    readonly byRiskBucket: readonly RiskBucket[];
    /** Abiertos o en revision cuyo plazo de SLA ya paso. */
    readonly overdue: number;
    /** Abiertos o en revision sin responsable asignado. */
    readonly unassigned: number;
  };
  readonly flow: readonly DailyCaseFlowPoint[];
  readonly enforcement: {
    readonly byStatus: Readonly<Record<string, number>>;
    readonly byActionType: Readonly<Record<string, number>>;
    readonly pendingApproval: number;
  };
  readonly workload: readonly AssigneeWorkload[];
  readonly resolution: {
    readonly resolvedInWindow: number;
    /** `null` cuando no se cerro ningun caso en la ventana. */
    readonly averageHoursToResolve: number | null;
  };
}

export interface FraudMetricsQuery {
  readonly organizationId: string;
  /** Longitud de la ventana temporal, en dias, para `flow` y `resolution`. */
  readonly windowDays: number;
  readonly now: Instant;
}

/**
 * Lado de lectura del panel. Vive como puerto propio, y no como un metodo
 * mas de `CaseRepository`, porque no devuelve agregados del dominio sino un
 * modelo de lectura: mezcla `cases`, `enforcement_actions` y `resolutions` y
 * no se puede rehidratar a nada.
 */
export interface FraudMetricsReader {
  snapshot(query: FraudMetricsQuery): Promise<FraudMetricsSnapshot>;
}
