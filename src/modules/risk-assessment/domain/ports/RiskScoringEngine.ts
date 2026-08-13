/** Output of a single scoring JDM evaluation — a raw integer validated via createRiskScore. */
export interface RiskScoringEvaluation {
  readonly riskScore: number;
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
