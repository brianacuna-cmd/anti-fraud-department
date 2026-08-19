import type { Case } from '../model/aggregates/Case.js';
import type { CaseId } from '../model/value-objects/CaseId.js';
import type { CaseStatus } from '../model/value-objects/CaseStatus.js';
import type { Transaction } from './UnitOfWork.js';

export interface CaseListPage {
  readonly items: readonly Case[];
  readonly nextCursor: string | null;
}

/**
 * Identity lookup for the intake paths' deduplication guard. `organizationId`
 * is mandatory and always applied: a case belonging to another tenant must
 * never satisfy a lookup, even when the customer identifiers match.
 *
 * `statuses` narrows the match to a lifecycle window. The two intake paths
 * want opposite things, so neither may rely on a default:
 * `IngestFinturuCase` passes the ACTIVE window (spec CASE-011: "si la entidad
 * ya tiene un caso OPEN o IN_REVIEW"), while `OpenFraudCaseFromCustomer`
 * omits it because reopening a RESOLVED/ARCHIVED case is its intended path.
 */
export interface FindCaseByIdentityOptions {
  readonly organizationId: string;
  readonly customerId?: string | null;
  readonly bridgeUserId?: string | null;
  readonly statuses?: readonly CaseStatus[];
}

/** The lifecycle window CASE-011 treats as "already has an open file". */
export const ACTIVE_CASE_STATUSES: readonly CaseStatus[] = ['OPEN', 'IN_REVIEW'];

/**
 * CASE-004's multi-criteria filter. Every field is optional and they compose
 * as AND; an omitted field never narrows the result.
 *
 * `organizationId` is deliberately nullable rather than absent: `null` means
 * "platform admin, span every tenant". Any other caller must pass a real id,
 * and the use case is what decides which — never the transport.
 */
export interface CaseListFilter {
  readonly organizationId?: string | null;
  readonly limit?: number;
  readonly cursor?: string;
  /** Single status, or several. `'ALL'` is accepted as "do not filter". */
  readonly status?: string | readonly string[];
  readonly priority?: string | readonly string[];
  readonly assignedToId?: string;
  /** `'UNASSIGNED'` matches the general inbox — cases with no assignee. */
  readonly assignedToType?: string;
  /** Matches cases carrying ALL of these tags. */
  readonly tags?: readonly string[];
  readonly riskScoreMin?: number;
  readonly riskScoreMax?: number;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly dueBefore?: string;
  /** When true, only cases whose deadline has already passed. */
  readonly overdueOnly?: boolean;
  readonly search?: string;
}

/**
 * Outbound port for the `Case` aggregate.
 */
export interface CaseRepository {
  save(kase: Case, tx?: Transaction): Promise<void>;
  findById(id: CaseId, tx?: Transaction): Promise<Case | null>;
  findByCustomerOrBridgeId(options: FindCaseByIdentityOptions, tx?: Transaction): Promise<Case | null>;
  list(filter?: CaseListFilter): Promise<CaseListPage>;
  /** Same predicate as `list`, without pagination — backs CASE-013's export. */
  countAll(filter?: CaseListFilter): Promise<number>;
}
