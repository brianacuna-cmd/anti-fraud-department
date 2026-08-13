import type { CaseRoutingRule } from '../model/aggregates/CaseRoutingRule.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Outbound port for `CaseRoutingRules`. T1 only needs active rules for an
 * organization — CRUD for rule management lands in a later slice.
 */
export interface CaseRoutingRuleRepository {
  findActiveByOrganization(organizationId: string, tx?: Transaction): Promise<readonly CaseRoutingRule[]>;
}
