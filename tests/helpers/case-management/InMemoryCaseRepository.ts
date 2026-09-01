import type { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import type {
  CaseListQuery,
  CaseListResult,
  CaseRepository,
  EntityIdentifierQuery,
  FindCaseByIdentityOptions,
} from '../../../src/modules/case-management/domain/ports/CaseRepository.js';
import { entityIdentifiersOf } from '../../../src/modules/case-management/domain/services/EntityNetworkGraph.js';
import { entityNodeKey } from '../../../src/modules/case-management/domain/model/value-objects/EntityNodeType.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';
import { toDate } from '../../../src/shared/time/Instant.js';

/** In-memory fake for unit/e2e-testing use cases and routes (mirrors `InMemoryOrganizationFraudConfigRepository`). */
export class InMemoryCaseRepository implements CaseRepository {
  private readonly byId = new Map<string, Case>();

  async save(kase: Case, _tx?: Transaction): Promise<void> {
    this.byId.set(kase.id, kase);
  }

  async findById(id: CaseId, _tx?: Transaction): Promise<Case | null> {
    return this.byId.get(id) ?? null;
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
    _tx?: Transaction,
  ): Promise<Case | null> {
    return (
      [...this.byId.values()].find(
        (kase) =>
          kase.organizationId === organizationId &&
          kase.idempotencyKey !== null &&
          kase.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async list(query: CaseListQuery, _tx?: Transaction): Promise<CaseListResult> {
    const filtered = [...this.byId.values()].filter((kase) => matchesListQuery(kase, query));
    filtered.sort(compareDueDateAscNullsLast);
    const total = filtered.length;
    const items = filtered.slice(query.offset, query.offset + query.limit);
    return { items, total };
  }

  /** Mirrors the Mongo adapter: same tenant, not deleted, customerId OR bridgeUserId. */
  async findByCustomerOrBridgeId(
    options: FindCaseByIdentityOptions,
    _tx?: Transaction,
  ): Promise<Case | null> {
    const { organizationId, customerId, bridgeUserId, statuses } = options;
    if (!customerId && !bridgeUserId) return null;

    const matches = [...this.byId.values()].filter((kase) => {
      if (kase.deletedAt !== null) return false;
      if (kase.organizationId !== organizationId) return false;
      if (statuses !== undefined && statuses.length > 0 && !statuses.includes(kase.status)) {
        return false;
      }
      const snapshot = kase.finturuCacheSnapshot ?? {};
      const byCustomer =
        customerId !== undefined &&
        customerId !== null &&
        (kase.customerId === customerId || String(snapshot.idUser ?? '') === customerId);
      const byBridge =
        bridgeUserId !== undefined &&
        bridgeUserId !== null &&
        (kase.bridgeUserId === bridgeUserId || String(snapshot.idUserBridge ?? '') === bridgeUserId);
      return byCustomer || byBridge;
    });

    if (matches.length === 0) return null;
    // The Mongo adapter sorts by `created_at` descending: the newest wins.
    matches.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
    return matches[0]!;
  }

  /**
   * Mirrors the Mongo adapter: same tenant, not deleted, and sharing ONE
   * identifier is enough. Reuses `entityIdentifiersOf` so the fake and the
   * domain cannot disagree on which fields count as an identifier.
   */
  async findByEntityIdentifiers(
    query: EntityIdentifierQuery,
    _tx?: Transaction,
  ): Promise<readonly Case[]> {
    const { organizationId, refs, limit } = query;
    if (refs.length === 0 || limit <= 0) return [];

    const wanted = new Set(refs.map((ref) => entityNodeKey(ref.type, ref.value)));
    const matches = [...this.byId.values()].filter((kase) => {
      if (kase.deletedAt !== null) return false;
      if (kase.organizationId !== organizationId) return false;
      return entityIdentifiersOf(kase).some((ref) => wanted.has(entityNodeKey(ref.type, ref.value)));
    });

    matches.sort((a, b) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime());
    return matches.slice(0, limit);
  }

  all(): readonly Case[] {
    return [...this.byId.values()];
  }
}

function matchesListQuery(kase: Case, query: CaseListQuery): boolean {
  if (kase.deletedAt !== null) return false;
  if (kase.organizationId !== query.organizationId) return false;
  if (query.customerId !== undefined && kase.customerId !== query.customerId) return false;
  if (query.status !== undefined && query.status.length > 0 && !query.status.includes(kase.status)) {
    return false;
  }
  if (
    query.priority !== undefined &&
    query.priority.length > 0 &&
    !query.priority.includes(kase.priority)
  ) {
    return false;
  }
  if (query.assignedToId !== undefined && kase.assignedTo?.id !== query.assignedToId) {
    return false;
  }
  if (query.riskScoreMin !== undefined && kase.riskScore < query.riskScoreMin) {
    return false;
  }
  if (query.riskScoreMax !== undefined && kase.riskScore > query.riskScoreMax) {
    return false;
  }
  if (query.tags !== undefined && query.tags.length > 0) {
    for (const tag of query.tags) {
      if (!kase.tags.includes(tag)) return false;
    }
  }
  if (query.dueAfter !== undefined) {
    if (kase.dueDate === null || toDate(kase.dueDate).getTime() < toDate(query.dueAfter).getTime()) {
      return false;
    }
  }
  if (query.dueBefore !== undefined) {
    if (kase.dueDate === null || toDate(kase.dueDate).getTime() >= toDate(query.dueBefore).getTime()) {
      return false;
    }
  }
  return true;
}

function compareDueDateAscNullsLast(a: Case, b: Case): number {
  if (a.dueDate === null && b.dueDate === null) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return toDate(a.dueDate).getTime() - toDate(b.dueDate).getTime();
}
