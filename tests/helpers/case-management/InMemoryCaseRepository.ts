import type { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import type { CaseRepository } from '../../../src/modules/case-management/domain/ports/CaseRepository.js';
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
    organizationId: string,
    customerId?: string | null,
    bridgeUserId?: string | null,
    _tx?: Transaction,
  ): Promise<Case | null> {
    for (const c of this.byId.values()) {
      if (c.organizationId === organizationId) {
        if (customerId && c.customerId === customerId) return c;
        if (bridgeUserId && c.bridgeUserId === bridgeUserId) return c;
        const snap = c.finturuCacheSnapshot as Record<string, any> | undefined;
        if (snap) {
          if (customerId && snap.idUser === customerId) return c;
          if (bridgeUserId && snap.idUserBridge === bridgeUserId) return c;
        }
      }
    }
    return null;
  }

  async list(
    organizationId?: string | null,
    limit: number = 50,
    _cursor?: string,
    status?: string,
  ): Promise<{ items: readonly Case[]; nextCursor: string | null }> {
    let items = [...this.byId.values()];
    if (organizationId) items = items.filter((c) => c.organizationId === organizationId);
    if (status) items = items.filter((c) => c.status === status);
    const paginated = items.slice(0, limit);
    return { items: paginated, nextCursor: null };
  }

  all(): readonly Case[] {
    return [...this.byId.values()];
  }
}
