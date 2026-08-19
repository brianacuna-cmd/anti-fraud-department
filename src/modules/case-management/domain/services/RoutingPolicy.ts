import type { CaseRoutingRule, RoutingConditions } from '../model/aggregates/CaseRoutingRule.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';

/**
 * Los datos del caso que una regla puede mirar.
 *
 * Es una proyeccion explicita y no el agregado `Case` entero, por dos motivos:
 * el enrutamiento ocurre ANTES de que el caso exista (hay que saber a quien
 * asignarlo para crearlo ya asignado), y acotar lo visible impide que una
 * regla acabe dependiendo de un campo interno que nadie penso como criterio.
 */
export interface RoutableCase {
  readonly riskScore: number;
  readonly priority: CasePriority;
  readonly tags: readonly string[];
  readonly customerEmail?: string | null;
  readonly stripeCustomerId?: string | null;
  readonly bridgeWallet?: string | null;
}

/** Dominio del email en minusculas, o `null` si no hay email o esta mal formado. */
function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Evalua las condiciones de una regla contra un caso.
 *
 * Conjuncion: toda condicion declarada debe cumplirse. Un objeto de
 * condiciones vacio encaja con todo — es como se expresa una regla de reserva
 * («todo lo que no haya caido antes, para este equipo»), y por eso el orden de
 * evaluacion importa tanto.
 */
export function matchesConditions(conditions: RoutingConditions, kase: RoutableCase): boolean {
  if (conditions.riskScoreMin !== undefined && kase.riskScore < conditions.riskScoreMin) return false;
  if (conditions.riskScoreMax !== undefined && kase.riskScore > conditions.riskScoreMax) return false;

  if (conditions.priorities !== undefined && conditions.priorities.length > 0) {
    if (!conditions.priorities.includes(kase.priority)) return false;
  }

  if (conditions.tags !== undefined && conditions.tags.length > 0) {
    // TODAS, no alguna: una regla que dispara con cualquier coincidencia
    // parcial enruta casos que su autor no pretendia capturar.
    if (!conditions.tags.every((tag) => kase.tags.includes(tag))) return false;
  }

  if (conditions.customerEmailDomain !== undefined) {
    const expected = conditions.customerEmailDomain.trim().toLowerCase().replace(/^@/, '');
    if (emailDomain(kase.customerEmail) !== expected) return false;
  }

  if (conditions.hasStripeCustomer !== undefined) {
    if (Boolean(kase.stripeCustomerId) !== conditions.hasStripeCustomer) return false;
  }

  if (conditions.hasBridgeWallet !== undefined) {
    if (Boolean(kase.bridgeWallet) !== conditions.hasBridgeWallet) return false;
  }

  return true;
}

/**
 * Primera regla ACTIVA que encaja, en orden de evaluacion ascendente.
 *
 * «La primera gana» y no «la mas especifica gana»: la especificidad habria que
 * inferirla, y dos reglas podrian empatar sin que nadie supiera cual manda. Un
 * numero explicito hace el desempate visible y editable por quien configura.
 *
 * El desempate secundario es el id, para que dos reglas con el mismo orden
 * produzcan siempre el mismo resultado en vez de depender de como las
 * devolviera la base ese dia.
 */
export function selectRoutingRule(
  rules: readonly CaseRoutingRule[],
  kase: RoutableCase,
): CaseRoutingRule | null {
  const candidates = rules
    .filter((rule) => rule.status === 'ACTIVE')
    .sort((a, b) =>
      a.evaluationOrder !== b.evaluationOrder
        ? a.evaluationOrder - b.evaluationOrder
        : a.id.localeCompare(b.id),
    );

  return candidates.find((rule) => matchesConditions(rule.conditions, kase)) ?? null;
}
