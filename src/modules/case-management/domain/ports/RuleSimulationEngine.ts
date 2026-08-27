import type { RuleSimulation } from '../../../../shared/rules/RuleSimulation.js';
import type { CaseRoutingContext } from './RoutingEngine.js';

export type { RuleSimulation, RuleTrace } from '../../../../shared/rules/RuleSimulation.js';

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
