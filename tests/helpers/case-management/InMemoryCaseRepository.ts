import type { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import type {
  CaseListQuery,
  CaseListResult,
  CaseRepository,
} from '../../../src/modules/case-management/domain/ports/CaseRepository.js';
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

  all(): readonly Case[] {
    return [...this.byId.values()];
  }
}

function matchesListQuery(kase: Case, query: CaseListQuery): boolean {
  if (kase.deletedAt !== null) return false;
  if (kase.organizationId !== query.organizationId) return false;
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
