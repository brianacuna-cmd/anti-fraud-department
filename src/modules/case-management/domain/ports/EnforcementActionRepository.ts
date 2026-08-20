import type { EnforcementAction } from '../model/aggregates/EnforcementAction.js';
import type { EnforcementActionId } from '../model/value-objects/EnforcementActionId.js';
import type { EnforcementActionStatus } from '../model/value-objects/EnforcementActionStatus.js';
import type { EnforcementActionType } from '../model/value-objects/EnforcementActionType.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Filtered, paginated history query for `enforcement_actions`. `organizationId`
 * is the tenant gate (always set by the use case); the rest narrow the history
 * by entity (`targetType`/`targetId`), lifecycle `status`, `actionType`, or
 * `caseId`. Newest-first by `created_at`.
 */
export interface EnforcementActionListQuery {
  readonly organizationId: string;
  readonly status?: EnforcementActionStatus;
  readonly actionType?: EnforcementActionType;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly caseId?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface EnforcementActionListResult {
  readonly items: readonly EnforcementAction[];
  readonly total: number;
}

export interface EnforcementActionRepository {
  save(action: EnforcementAction, tx?: Transaction): Promise<void>;
  findById(id: EnforcementActionId, tx?: Transaction): Promise<EnforcementAction | null>;
  findByCaseId(caseId: CaseId, tx?: Transaction): Promise<EnforcementAction[]>;
  list(query: EnforcementActionListQuery, tx?: Transaction): Promise<EnforcementActionListResult>;
}
