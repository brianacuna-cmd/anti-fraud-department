import type { PrivacyDataRequest } from '../../../src/modules/privacy/domain/model/aggregates/PrivacyDataRequest.js';
import type { PrivacyDataRequestId } from '../../../src/modules/privacy/domain/model/value-objects/PrivacyDataRequestId.js';
import type {
  PrivacyDataRequestListQuery,
  PrivacyDataRequestListResult,
  PrivacyDataRequestRepository,
} from '../../../src/modules/privacy/domain/ports/PrivacyDataRequestRepository.js';

export class InMemoryPrivacyDataRequestRepository implements PrivacyDataRequestRepository {
  private readonly rows = new Map<string, PrivacyDataRequest>();

  async save(request: PrivacyDataRequest): Promise<void> {
    this.rows.set(request.id, request);
  }

  async findById(id: PrivacyDataRequestId): Promise<PrivacyDataRequest | null> {
    return this.rows.get(id) ?? null;
  }

  async list(query: PrivacyDataRequestListQuery): Promise<PrivacyDataRequestListResult> {
    const items = [...this.rows.values()].filter((r) => {
      if (r.organizationId !== query.organizationId) return false;
      if (query.status !== undefined && query.status.length > 0 && !query.status.includes(r.status)) {
        return false;
      }
      if (query.type !== undefined && query.type.length > 0 && !query.type.includes(r.type)) {
        return false;
      }
      return true;
    });
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length };
  }

  all(): readonly PrivacyDataRequest[] {
    return [...this.rows.values()];
  }

  seed(request: PrivacyDataRequest): void {
    this.rows.set(request.id, request);
  }
}
