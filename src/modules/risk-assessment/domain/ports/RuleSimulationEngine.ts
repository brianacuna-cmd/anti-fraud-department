import type { RuleSimulation } from '../../../../shared/rules/RuleSimulation.js';

export type { RuleSimulation, RuleTrace } from '../../../../shared/rules/RuleSimulation.js';

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
