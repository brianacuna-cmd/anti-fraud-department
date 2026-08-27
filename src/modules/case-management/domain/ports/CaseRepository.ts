import type { Case } from '../model/aggregates/Case.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { CaseStatus } from '../model/value-objects/CaseStatus.js';
import type { CasePriority } from '../model/value-objects/CasePriority.js';
import type { Instant } from '../../../../shared/time/Instant.js';
import type { EntityRef } from '../model/value-objects/EntityNodeType.js';
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

/**
 * Identity with which Finturu ingestion looks up an already existing case
 * before opening a new one (CASE-011). `customerId` and `bridgeUserId`
 * compose as OR; `statuses`, when passed, bounds the lifecycle window.
 *
 * `IngestFinturuCase` passes the ACTIVE window (spec CASE-011: "si la entidad ya
 * tiene un caso OPEN o IN_REVIEW"), while `OpenFraudCaseFromCustomer` omits
 * it because reopening a RESOLVED/ARCHIVED case is its intended path.
 */
export interface FindCaseByIdentityOptions {
  readonly organizationId: string;
  readonly customerId?: string | null;
  readonly bridgeUserId?: string | null;
  readonly statuses?: readonly CaseStatus[];
}

/** The lifecycle window that CASE-011 treats as "already has an open case". */
export const ACTIVE_CASE_STATUSES: readonly CaseStatus[] = ['OPEN', 'IN_REVIEW'];

export interface CaseListResult {
  readonly items: readonly Case[];
  readonly total: number;
}

/**
 * Entity graph expansion (INV-013): cases of THIS organization that cite
 * any of `refs`.
 *
 * The `refs` compose as OR —sharing one identifier is enough to be in the
 * network— and `limit` bounds each round, because a widely shared identifier
 * (a corporate-domain email, an exchange wallet) can pull thousands of
 * cases and the next round would multiply them.
 */
export interface EntityIdentifierQuery {
  readonly organizationId: string;
  readonly refs: readonly EntityRef[];
  readonly limit: number;
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
  /**
   * Deduplication of Finturu ingestion (CASE-011): returns the case of THIS
   * organization that already covers the received identity, or `null`. Never
   * crosses tenants or returns deleted cases.
   */
  findByCustomerOrBridgeId(options: FindCaseByIdentityOptions, tx?: Transaction): Promise<Case | null>;
  /**
   * Entity graph expansion (INV-013). Returns the organization's cases that
   * cite any of the requested identifiers, without soft-deleted rows and
   * without crossing tenants.
   */
  findByEntityIdentifiers(query: EntityIdentifierQuery, tx?: Transaction): Promise<readonly Case[]>;
}
