import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { CanonicalRiskEvent } from '../domain/model/CanonicalRiskEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { RuleSimulation, RuleSimulationEngine } from '../domain/ports/RuleSimulationEngine.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SCORING_RULE_WRITE_ROLES } from './authorization/policy.js';
import { toScoringContext } from './CalculateRiskScore.js';

export interface SimulateScoringRuleInput {
  readonly auth: AuthContext;
  /** Draft graph: it may not exist as a rule yet. */
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly event: CanonicalRiskEvent;
}

export type SimulateScoringRuleResult =
  | ({
      readonly ok: true;
      /**
       * The score it would produce in production, or `null` when the graph
       * returns something `RiskScore` rejects. `warning` then says what, and
       * the trace still travels: that is exactly when it is most needed.
       */
      readonly riskScore: number | null;
      readonly warning: string | null;
    } & RuleSimulation)
  | { readonly ok: false; readonly message: string };

export interface SimulateScoringRuleDeps {
  readonly simulationEngine: RuleSimulationEngine;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Dry run: evaluates a graph against a sample event without persisting
 * anything and without touching the active rule.
 *
 * It exists because the decision editor has to answer "what does this score?"
 * BEFORE the rule exists, and the only honest way to answer is with the same
 * engine that will evaluate it in production — a separate simulator would end
 * up disagreeing on exactly the odd cases that matter in fraud.
 *
 * SUPERVISOR only, the role that drafts rules. It does not widen what that
 * role can already do: creating and activating a rule already runs its graph
 * against every incoming event. What changes is when they find out it is
 * wrong.
 *
 * A graph that does not compile returns `ok: false` instead of throwing: that
 * it does not compile is the answer the caller came for, and whoever is
 * drawing it needs to read the reason and keep editing.
 */
export function createSimulateScoringRuleUseCase(deps: SimulateScoringRuleDeps) {
  return async function simulateScoringRule(
    input: SimulateScoringRuleInput,
  ): Promise<SimulateScoringRuleResult> {
    requireOperationalRole(input.auth, SCORING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const outcome = await simulate(deps, input);

    /*
     * Audited even though nothing persists: running a graph on the tenant's
     * engine is an act, and a dry run that leaves no trail is exactly the gap
     * through which something gets tested that nobody later admits to having
     * tested. The trace is NOT stored — it can carry sample-event data, and
     * the audit trail is not a debugging store.
     */
    await deps.auditRecorder.record({
      organizationId,
      actorType: input.auth.actorType,
      actorId: input.auth.userId,
      action: 'SIMULATE_SCORING_RULE',
      resource: 'rule',
      resourceId: null,
      detail: outcome.ok
        ? { riskScore: outcome.riskScore, warning: outcome.warning }
        : { failed: true, reason: outcome.message },
      ipAddress: input.auth.ipAddress,
    });

    return outcome;
  };
}

async function simulate(
  deps: SimulateScoringRuleDeps,
  input: SimulateScoringRuleInput,
): Promise<SimulateScoringRuleResult> {
  let simulation: RuleSimulation;
  try {
    simulation = await deps.simulationEngine.simulate(
      input.conditions,
      toScoringContext(input.event),
    );
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  /*
   * The score is validated here rather than let through: a graph returning 140
   * has to show the problem in the dry run, not in production, where
   * `CalculateRiskScore` fails closed and no case opens at all.
   */
  const raw = (simulation.result as Record<string, unknown> | null)?.riskScore;
  try {
    return { ok: true, riskScore: createRiskScore(raw as number), warning: null, ...simulation };
  } catch (error) {
    return {
      ok: true,
      riskScore: null,
      warning: error instanceof Error ? error.message : String(error),
      ...simulation,
    };
  }
}
