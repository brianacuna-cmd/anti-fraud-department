import type { Case } from '../model/aggregates/Case.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { Transaction } from './UnitOfWork.js';

export interface CaseListPage {
  readonly items: readonly Case[];
  readonly nextCursor: string | null;
}

/**
 * Outbound port for the `Case` aggregate.
 */
export interface CaseRepository {
  save(kase: Case, tx?: Transaction): Promise<void>;
  findById(id: CaseId, tx?: Transaction): Promise<Case | null>;
  findByCustomerOrBridgeId(
    organizationId: string,
    customerId?: string | null,
    bridgeUserId?: string | null,
    tx?: Transaction,
  ): Promise<Case | null>;
  list(organizationId?: string | null, limit?: number, cursor?: string, status?: string): Promise<CaseListPage>;
}
