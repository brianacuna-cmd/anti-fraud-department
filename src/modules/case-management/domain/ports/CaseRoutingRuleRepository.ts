import type { CaseRoutingRule } from '../model/aggregates/CaseRoutingRule.js';
import type { CaseRoutingRuleId } from '../model/value-objects/CaseRoutingRuleId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `CaseRoutingRules`. T1 reads ACTIVE rules; draft CRUD
 * uses save / findById / listByOrganization (non-exclusive ACTIVE allowed).
 */
export interface CaseRoutingRuleRepository {
  findActiveByOrganization(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]>;
  findById(id: CaseRoutingRuleId, tx?: Transaction): Promise<CaseRoutingRule | null>;
  listByOrganization(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]>;
  save(rule: CaseRoutingRule, tx?: Transaction): Promise<void>;
}
