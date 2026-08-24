import type { Case } from '../model/aggregates/Case.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { CaseStatus } from '../model/value-objects/CaseStatus.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { Transaction } from './UnitOfWork.js';

/**
 * Inbox list query (PR3). Always scoped to one organization; soft-deleted
 * cases are excluded by every adapter. Default sort is dueDate ASC with
 * nulls last.
 */
export interface CaseListQuery {
  readonly organizationId: string;
  readonly status?: readonly CaseStatus[];
  readonly priority?: readonly CasePriority[];
  readonly assignedToId?: string;
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly tags?: readonly string[];
  readonly dueAfter?: Instant;
  readonly dueBefore?: Instant;
  readonly limit: number;
  readonly offset: number;
}

export interface CaseListResult {
  readonly items: readonly Case[];
  readonly total: number;
}

/** Outbound port for the `Case` aggregate (save/findById + inbox `list`). */
export interface CaseRepository {
  save(kase: Case, tx?: Transaction): Promise<void>;
  findById(id: CaseId, tx?: Transaction): Promise<Case | null>;
  /**
   * Idempotency lookup (RF-3/RF-5): org-scoped, matches ONLY a present
   * non-null `idempotencyKey` — mirrors the Mongo unique partial index's
   * null-exclusion semantics.
   */
  findByIdempotencyKey(organizationId: string, idempotencyKey: string, tx?: Transaction): Promise<Case | null>;
  list(query: CaseListQuery, tx?: Transaction): Promise<CaseListResult>;
}
