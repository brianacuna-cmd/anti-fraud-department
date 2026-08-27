import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseRoutingContext } from '../domain/ports/RoutingEngine.js';
import type { RuleSimulation, RuleSimulationEngine } from '../domain/ports/RuleSimulationEngine.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface SimulateRoutingRuleInput {
  readonly auth: AuthContext;
  /** Grafo en borrador: puede no existir todavía como regla. */
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly context: CaseRoutingContext;
}

export type SimulateRoutingRuleResult =
  | ({
      readonly ok: true;
      /**
       * A quién asignaría. Ambos nulos NO es un fallo: es lo que `RouteCase`
       * lee como «esta regla no asigna con este caso» antes de pasar a la
       * siguiente. Distinguirlo de un grafo roto es lo que hace útil la prueba.
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
 * Ensayo en seco de una regla de enrutamiento: evalúa un grafo contra un caso
 * de ejemplo sin guardar nada y sin tocar las reglas activas. Gemelo de
 * `SimulateScoringRule` en risk-assessment.
 */
export function createSimulateRoutingRuleUseCase(deps: SimulateRoutingRuleDeps) {
  return async function simulateRoutingRule(
    input: SimulateRoutingRuleInput,
  ): Promise<SimulateRoutingRuleResult> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const outcome = await simulate(deps, input);

    /* Se audita aunque no persista nada: ejecutar un grafo en el motor es un acto. */
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
