import type { CaseRoutingContext } from './RoutingEngine.js';

/** Una parada del recorrido: qué entró en un nodo y qué salió de él. */
export interface RuleTrace {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly performance?: string;
  readonly traceData?: unknown;
  readonly order: number;
}

/** Resultado crudo de una evaluación, sin plegar. */
export interface RuleSimulation {
  readonly performance: string;
  readonly result: unknown;
  readonly trace?: Readonly<Record<string, RuleTrace>>;
}

/**
 * Puerto de ensayo en seco, separado de `RoutingEngine` a propósito.
 *
 * `RoutingEngine` pliega a los dos destinos, que es lo único que `RouteCase`
 * necesita. Quien está DIBUJANDO la regla necesita el recorrido nodo a nodo,
 * y eso no tiene por qué cargarlo el camino caliente.
 */
export interface RuleSimulationEngine {
  simulate(
    conditions: Readonly<Record<string, unknown>>,
    context: CaseRoutingContext,
  ): Promise<RuleSimulation>;
}
