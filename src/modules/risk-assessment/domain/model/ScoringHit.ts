/**
 * Documentation type for engine collect evidence. Runtime evaluate /
 * CalculateRiskScore keep `hits: readonly unknown[]` and MUST NOT parse
 * or validate this shape — JDM graphs often emit `{points}` only.
 */
export interface ScoringHit {
  readonly id?: string;
  readonly name?: string;
  readonly points?: unknown;
  readonly because?: unknown;
  readonly signal?: unknown;
}
