import type { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import type {
  CaseListFilter,
  CaseRepository,
  FindCaseByIdentityOptions,
} from '../../../src/modules/case-management/domain/ports/CaseRepository.js';
import type { CaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

/** In-memory fake for unit/e2e-testing use cases and routes (mirrors `InMemoryOrganizationFraudConfigRepository`). */
export class InMemoryCaseRepository implements CaseRepository {
  private readonly byId = new Map<string, Case>();

  async save(kase: Case, _tx?: Transaction): Promise<void> {
    this.byId.set(kase.id, kase);
  }

  async findById(id: CaseId, _tx?: Transaction): Promise<Case | null> {
    return this.byId.get(id) ?? null;
  }

  async findByCustomerOrBridgeId(
    options: FindCaseByIdentityOptions,
    _tx?: Transaction,
  ): Promise<Case | null> {
    const { organizationId, customerId, bridgeUserId, statuses } = options;

    for (const c of this.byId.values()) {
      if (c.organizationId !== organizationId) continue;
      if (statuses && statuses.length > 0 && !statuses.includes(c.status)) continue;

      if (customerId && c.customerId === customerId) return c;
      if (bridgeUserId && c.bridgeUserId === bridgeUserId) return c;

      const snap = c.finturuCacheSnapshot as Record<string, any> | undefined;
      if (snap) {
        if (customerId && String(snap.idUser) === customerId) return c;
        if (bridgeUserId && snap.idUserBridge === bridgeUserId) return c;
      }
    }
    return null;
  }

  /** Mirrors `MongoCaseRepository.buildFilter` so tests exercise the same predicate. */
  private matches(c: Case, filter: CaseListFilter): boolean {
    if (c.deletedAt !== null) return false;
    if (filter.organizationId && c.organizationId !== filter.organizationId) return false;

    const inOrEq = (value: string | readonly string[] | undefined, actual: string): boolean => {
      if (value === undefined) return true;
      const values = (Array.isArray(value) ? value : [value]).filter((v) => v && v !== 'ALL');
      return values.length === 0 || values.includes(actual);
    };

    if (!inOrEq(filter.status, c.status)) return false;
    if (!inOrEq(filter.priority, c.priority)) return false;

    if (filter.assignedToType === 'UNASSIGNED') {
      if (c.assignedTo !== null) return false;
    } else {
      if (filter.assignedToId && c.assignedTo?.id !== filter.assignedToId) return false;
      if (filter.assignedToType && c.assignedTo?.type !== filter.assignedToType) return false;
    }

    if (filter.tags && filter.tags.length > 0) {
      if (!filter.tags.every((tag) => c.tags.includes(tag))) return false;
    }

    if (filter.riskScoreMin !== undefined && c.riskScore < filter.riskScoreMin) return false;
    if (filter.riskScoreMax !== undefined && c.riskScore > filter.riskScoreMax) return false;

    if (filter.createdFrom !== undefined && c.createdAt < filter.createdFrom) return false;
    if (filter.createdTo !== undefined && c.createdAt > filter.createdTo) return false;

    if (filter.overdueOnly) {
      if (c.dueDate === null || c.dueDate >= new Date().toISOString()) return false;
    } else if (filter.dueBefore !== undefined) {
      if (c.dueDate === null || c.dueDate > filter.dueBefore) return false;
    }

    if (filter.search && filter.search.trim().length > 0) {
      const term = filter.search.trim().toLowerCase();
      const haystack = [
        c.customerId,
        c.customerEmail,
        c.bridgeUserId,
        c.bridgeWallet,
        c.stripeCustomerId,
      ];
      if (!haystack.some((v) => typeof v === 'string' && v.toLowerCase().includes(term))) return false;
    }

    return true;
  }

  async list(filter: CaseListFilter = {}): Promise<{ items: readonly Case[]; nextCursor: string | null }> {
    const limit = filter.limit ?? 50;
    const matching = [...this.byId.values()].filter((c) => this.matches(c, filter));
    return { items: matching.slice(0, limit), nextCursor: null };
  }

  async countAll(filter: CaseListFilter = {}): Promise<number> {
    return [...this.byId.values()].filter((c) => this.matches(c, filter)).length;
  }
}
