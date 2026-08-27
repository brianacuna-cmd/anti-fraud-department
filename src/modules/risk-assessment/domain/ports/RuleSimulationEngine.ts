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
 * Puerto de ensayo en seco, separado de `RiskScoringEngine` a propósito.
 *
 * `RiskScoringEngine` pliega: devuelve la puntuación entera y los aciertos,
 * que es lo único que producción necesita. Quien está DIBUJANDO la regla
 * necesita lo contrario —el recorrido nodo a nodo, con lo que entró y salió
 * de cada uno—, y meter eso en el puerto de producción obligaría a todo el
 * camino caliente a cargar con una traza que nadie mira.
 */
export interface RuleSimulationEngine {
  simulate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RuleSimulation>;
}
