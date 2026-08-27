import type { CaseRoutingContext } from './RoutingEngine.js';

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
 * Dry-run port, deliberately separate from `RoutingEngine`.
 *
 * `RoutingEngine` folds down to the two targets, which is all `RouteCase`
 * needs. Whoever is DRAWING the rule needs the node-by-node run instead, and
 * the hot path has no business carrying that.
 */
export interface RuleSimulationEngine {
  simulate(
    conditions: Readonly<Record<string, unknown>>,
    context: CaseRoutingContext,
  ): Promise<RuleSimulation>;
}
