import { ZenEngine } from '@gorules/zen-engine';
import type {
  RiskScoringEngine,
  RiskScoringEvaluation,
} from '../../../../domain/ports/RiskScoringEngine.js';
import type {
  RuleSimulation,
  RuleSimulationEngine,
} from '../../../../domain/ports/RuleSimulationEngine.js';
import { enrichCollectHitOutputs } from './enrichCollectHitOutputs.js';

/**
 * `@gorules/zen-engine` adapter for the `RiskScoringEngine` port. The only
 * place in the risk-assessment module allowed to import `@gorules/zen-engine`,
 * mirroring `ZenRoutingEngine` in case-management.
 *
 * Each `evaluate` compiles the rule's JDM graph into a `ZenDecision` (graphs
 * differ per rule; no decision caching). When the graph emits a `hits` array
 * (collect node), it is passed through for evidence freeze; Expression still
 * folds the integer `riskScore`. Missing or non-integer `riskScore` throws so
 * `CalculateRiskScore` can fail closed. Missing/non-array `hits` defaults to `[]`.
 */
export class ZenRiskScoringEngine implements RiskScoringEngine, RuleSimulationEngine {
  private readonly engine: ZenEngine;

  constructor(engine: ZenEngine = new ZenEngine()) {
    this.engine = engine;
  }

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation> {
    const decision = this.engine.createDecision(enrichCollectHitOutputs(conditions));
    const { result } = await decision.evaluate(context);
    return toEvaluation(result);
  }

  /**
   * Traced evaluation, for the editor's dry run.
   *
   * `trace: true` is what separates this from `evaluate`: it returns what went
   * into and out of each node, which is what the editor paints over the graph.
   * It stays off in `evaluate` because production evaluates once per incoming
   * event and nobody reads that trace.
   */
  async simulate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RuleSimulation> {
    const decision = this.engine.createDecision(enrichCollectHitOutputs(conditions));
    const response = await decision.evaluate(context, { trace: true });
    return {
      performance: response.performance,
      result: response.result,
      ...(response.trace === undefined ? {} : { trace: response.trace }),
    };
  }

  /** Releases the native ZEN engine handle. Call at composition-root shutdown. */
  dispose(): void {
    this.engine.dispose();
  }
}

function toEvaluation(result: unknown): RiskScoringEvaluation {
  const output = (result ?? {}) as Record<string, unknown>;
  const riskScore = output.riskScore;
  if (typeof riskScore !== 'number' || !Number.isInteger(riskScore)) {
    throw new Error('scoring engine output riskScore must be an integer');
  }
  const hits = Array.isArray(output.hits) ? output.hits : [];
  return { riskScore, hits };
}
