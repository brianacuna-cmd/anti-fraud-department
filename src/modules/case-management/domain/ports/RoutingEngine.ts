/** Input context passed to ZEN Engine when evaluating a routing rule against a case. */
export interface CaseRoutingContext {
  readonly riskScore: number;
  readonly status: string;
  readonly priority: string;
  readonly tags: readonly string[];
}

/** Output of a single JDM evaluation — null targets mean the rule did not match. */
export interface RoutingEvaluation {
  readonly targetUserId: string | null;
  readonly targetRoleId: string | null;
}

/**
 * Outbound port for JDM rule evaluation (design: "ZEN Engine — T1 only").
 * Infrastructure supplies a `@gorules/zen-engine` adapter; application and
 * domain depend only on this interface.
 */
export interface RoutingEngine {
  evaluate(
    conditions: Readonly<Record<string, unknown>>,
    context: CaseRoutingContext,
  ): Promise<RoutingEvaluation | null>;
}
