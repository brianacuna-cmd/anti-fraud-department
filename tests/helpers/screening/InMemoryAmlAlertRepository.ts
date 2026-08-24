import type { AmlAlert } from '../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import type { AmlAlertId } from '../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import type {
  AmlAlertListQuery,
  AmlAlertListResult,
  AmlAlertNaturalKey,
  AmlAlertRepository,
} from '../../../src/modules/screening/domain/ports/AmlAlertRepository.js';

function naturalKeyOf(alert: AmlAlert): string {
  return [alert.organizationId, alert.customerId, alert.matchedEntry.entryId, alert.matchedEntry.matchField].join('|');
}

function naturalKeyFrom(key: AmlAlertNaturalKey): string {
  return [key.organizationId, key.customerId, key.entryId, key.matchField].join('|');
}

/** In-memory `AmlAlertRepository` fake — upsert by id, duplicate on natural key. */
export class InMemoryAmlAlertRepository implements AmlAlertRepository {
  private readonly byId = new Map<string, AmlAlert>();

  async save(alert: AmlAlert): Promise<'inserted' | 'updated' | 'duplicate'> {
    const id = String(alert.id);
    const existingById = this.byId.get(id);
    if (existingById) {
      this.byId.set(id, alert);
      return 'updated';
    }
    const existingByKey = [...this.byId.values()].find((stored) => naturalKeyOf(stored) === naturalKeyOf(alert));
    if (existingByKey) {
      return 'duplicate';
    }
    this.byId.set(id, alert);
    return 'inserted';
  }

  async findById(id: AmlAlertId): Promise<AmlAlert | null> {
    return this.byId.get(String(id)) ?? null;
  }

  async findByNaturalKey(key: AmlAlertNaturalKey): Promise<AmlAlert | null> {
    const encoded = naturalKeyFrom(key);
    return [...this.byId.values()].find((stored) => naturalKeyOf(stored) === encoded) ?? null;
  }

  async list(query: AmlAlertListQuery): Promise<AmlAlertListResult> {
    const filtered = [...this.byId.values()]
      .filter((alert) => alert.organizationId === query.organizationId)
      .filter((alert) => query.estado === undefined || query.estado.length === 0 || query.estado.includes(alert.estado))
      .sort((a, b) => (b.createdAt as string).localeCompare(a.createdAt as string));
    return {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
    };
  }

  all(): AmlAlert[] {
    return [...this.byId.values()];
  }
}
