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
  /** Grafo en borrador: puede no existir todavía como regla. */
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly event: CanonicalRiskEvent;
}

export type SimulateScoringRuleResult =
  | ({
      readonly ok: true;
      /**
       * La puntuación que produciría en producción, o `null` si el grafo
       * devuelve algo que `RiskScore` no acepta. En ese caso `warning` dice
       * qué, y la traza sigue viajando: es justo cuando más falta hace.
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
 * Ensayo en seco: evalúa un grafo contra un evento de ejemplo sin guardar nada
 * y sin tocar la regla activa.
 *
 * Existe porque el editor de decisiones necesita responder «¿esto qué
 * puntúa?» ANTES de que la regla exista, y la única forma honesta de
 * responderlo es con el mismo motor que la evaluará en producción — un
 * simulador aparte acabaría discrepando justo en los casos raros.
 *
 * Reservado al SUPERVISOR, que es quien redacta reglas. No amplía lo que ese
 * rol ya puede hacer: crear y activar una regla ya ejecuta su grafo contra
 * cada evento entrante. Lo que cambia es cuándo se entera de que está mal.
 *
 * Un grafo que no compila devuelve `ok: false` en vez de lanzar: que no
 * compile es el resultado que se ha venido a buscar, y quien está dibujando
 * necesita leer el motivo y seguir editando.
 */
export function createSimulateScoringRuleUseCase(deps: SimulateScoringRuleDeps) {
  return async function simulateScoringRule(
    input: SimulateScoringRuleInput,
  ): Promise<SimulateScoringRuleResult> {
    requireOperationalRole(input.auth, SCORING_RULE_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const outcome = await simulate(deps, input);

    /*
     * Se audita aunque no persista nada: ejecutar un grafo en el motor del
     * inquilino es un acto, y un ensayo que no deja rastro es justo el hueco
     * por el que se prueba algo que luego nadie reconoce haber probado. La
     * traza NO se guarda —puede llevar datos del evento de prueba y el rastro
     * de auditoría no es un almacén de depuración.
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
   * La puntuación se valida aquí y no se deja pasar: un grafo que devuelve 140
   * tiene que enseñar el problema en la prueba, y no en producción, donde
   * `CalculateRiskScore` falla cerrado y deja de abrirse ningún caso.
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
