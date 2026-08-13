import { invariantViolation } from '../../errors/CaseManagementError.js';

export type RoutingRuleStatus = 'ACTIVE' | 'INACTIVE';

const VALID_STATUSES: ReadonlySet<string> = new Set<RoutingRuleStatus>(['ACTIVE', 'INACTIVE']);

export function createRoutingRuleStatus(value: string): RoutingRuleStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('RoutingRuleStatus must be one of ACTIVE, INACTIVE', { value });
  }
  return value as RoutingRuleStatus;
}
