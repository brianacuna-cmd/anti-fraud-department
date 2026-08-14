/** Output of a single scoring JDM evaluation — integer score plus optional hit evidence. */
export interface RiskScoringEvaluation {
  readonly riskScore: number;
  /** Collect-node evidence; empty when the graph omits a hits array. Never folded by app code. */
  readonly hits: readonly unknown[];
}

/**
 * Outbound port for JDM scoring evaluation. Infrastructure supplies a
 * `@gorules/zen-engine` adapter; application and domain depend only on this
 * interface. Context MUST already omit `rawPayload`.
 */
export interface RiskScoringEngine {
  evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: Readonly<Record<string, unknown>>,
  ): Promise<RiskScoringEvaluation>;
}
