import type { CaseRoutingRule } from '../model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../model/value-objects/CaseRoutingRuleId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Puerto de salida del agregado `CaseRoutingRule` (CASE-002).
 *
 * `listActive` devuelve solo las reglas ACTIVE del inquilino. El filtro por
 * estado va en la consulta y no en el evaluador para que una regla desactivada
 * no llegue siquiera a cargarse: es la diferencia entre "no aplica" y "podria
 * aplicar si alguien se equivoca al filtrar".
 */
export interface CaseRoutingRuleRepository {
  save(rule: CaseRoutingRule, tx?: Transaction): Promise<void>;
  findById(id: CaseRoutingRuleId, tx?: Transaction): Promise<CaseRoutingRule | null>;
  listActive(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]>;
  listAll(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]>;
}
