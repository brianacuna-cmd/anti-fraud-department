import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingContext } from '../domain/ports/RoutingEngine.js';
import type { RuleSimulation, RuleSimulationEngine } from '../domain/ports/RuleSimulationEngine.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface SimulateRoutingRuleInput {
  readonly auth: AuthContext;
  /** Draft graph: it may not exist as a rule yet. */
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly context: CaseRoutingContext;
}

export type SimulateRoutingRuleResult =
  | ({
      readonly ok: true;
      /**
       * Who it would assign to. Both null is NOT a failure: it is what
       * `RouteCase` reads as "this rule assigns nobody for this case" before
       * moving to the next one. Telling that apart from a broken graph is
       * what makes the dry run worth running.
       */
      readonly targetUserId: string | null;
      readonly targetRoleId: string | null;
    } & RuleSimulation)
  | { readonly ok: false; readonly message: string };

export interface SimulateRoutingRuleDeps {
  readonly simulationEngine: RuleSimulationEngine;
  readonly auditRecorder: AuditRecorder;
}

/**
 * Routing-rule dry run: evaluates a graph against a sample case without
 * persisting anything and without touching the active rules. Twin of
 * `SimulateScoringRule` in risk-assessment.
 */
export function createSimulateRoutingRuleUseCase(deps: SimulateRoutingRuleDeps) {
  return async function simulateRoutingRule(
    input: SimulateRoutingRuleInput,
  ): Promise<SimulateRoutingRuleResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const outcome = await simulate(deps, input);

    /* Audited even though nothing persists: running a graph on the engine is an act. */
    await deps.auditRecorder.record(
      {
        organizationId,
        actorType: input.auth.actorType,
        actorId: input.auth.userId,
        action: 'SIMULATE_ROUTING_RULE',
        resource: 'rule',
        resourceId: null,
        detail: outcome.ok
          ? { targetUserId: outcome.targetUserId, targetRoleId: outcome.targetRoleId }
          : { failed: true, reason: outcome.message },
        ipAddress: input.auth.ipAddress,
      },
      undefined,
    );

    return outcome;
  };
}

async function simulate(
  deps: SimulateRoutingRuleDeps,
  input: SimulateRoutingRuleInput,
): Promise<SimulateRoutingRuleResult> {
  let simulation: RuleSimulation;
  try {
    simulation = await deps.simulationEngine.simulate(input.conditions, input.context);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const output = (simulation.result ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    targetUserId: asNonEmptyString(output.targetUserId),
    targetRoleId: asNonEmptyString(output.targetRoleId),
    ...simulation,
  };
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
