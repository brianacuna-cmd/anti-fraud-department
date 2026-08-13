import { ZenEngine } from '@gorules/zen-engine';
import type {
  RiskScoringEngine,
  RiskScoringEvaluation,
} from '../../../../domain/ports/RiskScoringEngine.js';

/**
 * `@gorules/zen-engine` adapter for the `RiskScoringEngine` port. The only
 * place in the risk-assessment module allowed to import `@gorules/zen-engine`,
 * mirroring `ZenRoutingEngine` in case-management.
 *
 * Each `evaluate` compiles the rule's JDM graph into a `ZenDecision` (graphs
 * differ per rule; no decision caching). Collect arrays are ignored here —
 * the graph's Expression node must emit a single integer `riskScore`. Missing
 * or non-integer output throws so `CalculateRiskScore` can fail closed.
 */
export class ZenRiskScoringEngine implements RiskScoringEngine {
  private readonly engine: ZenEngine;

  constructor(engine: ZenEngine = new ZenEngine()) {
    this.engine = engine;
  }

  async evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation> {
    const decision = this.engine.createDecision(conditions);
    const { result } = await decision.evaluate(context);
    return toEvaluation(result);
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
  return { riskScore };
}
