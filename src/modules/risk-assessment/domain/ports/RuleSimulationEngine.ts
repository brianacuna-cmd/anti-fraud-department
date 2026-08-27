/** One stop along the run: what went into a node and what came out of it. */
export interface RuleTrace {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly performance?: string;
  readonly traceData?: unknown;
  readonly order: number;
}

/** Raw evaluation result, unfolded. */
export interface RuleSimulation {
  readonly performance: string;
  readonly result: unknown;
  readonly trace?: Readonly<Record<string, RuleTrace>>;
}

/**
 * Dry-run port, deliberately separate from `RiskScoringEngine`.
 *
 * `RiskScoringEngine` folds: it returns the integer score and the hits, which
 * is all production needs. Whoever is DRAWING the rule needs the opposite —
 * the node-by-node run, with what went in and out of each one — and putting
 * that in the production port would make the whole hot path carry a trace
 * nobody ever looks at.
 */
export interface RuleSimulationEngine {
  simulate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RuleSimulation>;
}
