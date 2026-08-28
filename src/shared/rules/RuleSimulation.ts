/**
 * Shape of a traced JDM evaluation, shared by the modules that own a decision
 * engine (case-management routing, risk-assessment scoring).
 *
 * It lives in `shared/` for the same reason `jdmGraphSchema` does: both
 * modules speak the SAME engine's vocabulary, and a domain may not import
 * another module's domain. Declaring it twice was not just duplication — it
 * meant a change to the trace shape could land in one module and not the
 * other, and the decision editor reads both through the same panel.
 */

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
