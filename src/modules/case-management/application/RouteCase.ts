import type { CaseRoutingRuleRepository } from '../domain/ports/CaseRoutingRuleRepository.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
import type { Transaction } from '../domain/ports/UnitOfWork.js';
import type { AssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import type { RoutableCase } from '../domain/services/RoutingPolicy.js';
import { selectRoutingRule } from '../domain/services/RoutingPolicy.js';

export interface RouteCaseInput {
  readonly organizationId: string;
  readonly kase: RoutableCase;
  readonly tx?: Transaction;
}

export interface RouteCaseOutcome {
  readonly assignedTo: AssignedTo | null;
  /** Nombre de la regla que decidio, para el asiento de la linea de tiempo. */
  readonly ruleName: string | null;
  readonly ruleId: string | null;
}

export interface RouteCaseDeps {
  readonly routingRules: CaseRoutingRuleRepository;
  readonly assigneeDirectory: AssigneeDirectory;
}

/**
 * CASE-002 — resuelve el responsable de un caso recien abierto.
 *
 * Corre DENTRO de la transaccion que crea el caso, para que el expediente
 * nazca ya asignado en lugar de aparecer un instante en la bandeja general y
 * moverse despues.
 *
 * Nunca lanza. Un fallo de enrutamiento —no hay reglas, ninguna encaja, o el
 * destinatario de la que encajo ya no existe— tiene que degradar a "sin
 * asignar", jamas impedir que se abra el expediente: perder la deteccion de un
 * fraude porque una regla de configuracion estaba mal es un desenlace mucho
 * peor que un caso que espera en la bandeja general.
 */
export function createRouteCaseService(deps: RouteCaseDeps) {
  return async function routeCase(input: RouteCaseInput): Promise<RouteCaseOutcome> {
    const empty: RouteCaseOutcome = { assignedTo: null, ruleName: null, ruleId: null };

    let rules;
    try {
      rules = await deps.routingRules.listActive(input.organizationId, input.tx);
    } catch (error) {
      console.warn(`[routing] no se pudieron leer las reglas de ${input.organizationId}: ${(error as Error).message}`);
      return empty;
    }

    if (rules.length === 0) return empty;

    const rule = selectRoutingRule(rules, input.kase);
    if (!rule) return empty;

    // El destinatario se verifica igual que en una asignacion manual. Una regla
    // puede apuntar a alguien que se dio de baja despues de escribirla, y
    // aceptarla a ciegas dejaria el caso con dueno en la base de datos pero sin
    // nadie a quien reclamar — que es justo lo que `AssigneeDirectory` existe
    // para impedir.
    try {
      const exists =
        rule.assignTo.type === 'USER'
          ? await deps.assigneeDirectory.userExists(input.organizationId, rule.assignTo.id)
          : await deps.assigneeDirectory.roleExists(rule.assignTo.id);

      if (!exists) {
        console.warn(
          `[routing] la regla "${rule.name}" apunta a ${rule.assignTo.type}:${rule.assignTo.id}, que ya no existe`,
        );
        return empty;
      }
    } catch (error) {
      console.warn(`[routing] no se pudo verificar el destinatario de "${rule.name}": ${(error as Error).message}`);
      return empty;
    }

    return { assignedTo: rule.assignTo, ruleName: rule.name, ruleId: rule.id };
  };
}

export type RouteCaseService = ReturnType<typeof createRouteCaseService>;
