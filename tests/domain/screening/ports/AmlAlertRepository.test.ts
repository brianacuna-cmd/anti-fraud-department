import { oid } from '../../../support/oid.js';
import type { AmlAlertRepository } from '../../../../src/modules/screening/domain/ports/AmlAlertRepository.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { generateAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildAlert(): AmlAlert {
  return AmlAlert.create({
    id: generateAmlAlertId(),
    organizationId: oid('org-1'),
    customerId: oid('customer-1'),
    entidadSospechosa: 'John Smith',
    confianza: createMatchScore(82),
    fuenteDeteccion: 'index',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      nombre: 'John Smith',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

/** In-memory fake proving the port's shape is implementable and idempotent-by-natural-key by contract, ahead of the Mongo adapter. */
class InMemoryAmlAlertRepository implements AmlAlertRepository {
  private readonly byId = new Map<string, AmlAlert>();

  async save(alert: AmlAlert): Promise<void> {
    const key = naturalKey(alert);
    const existing = [...this.byId.values()].find((a) => naturalKey(a) === key);
    if (existing) {
      return;
    }
    this.byId.set(alert.id, alert);
  }

  async findById(id: string): Promise<AmlAlert | null> {
    return this.byId.get(id) ?? null;
  }
}

function naturalKey(alert: AmlAlert): string {
  return [alert.organizationId, alert.customerId, alert.matchedEntry.entryId, alert.matchedEntry.matchField].join('|');
}

describe('AmlAlertRepository (port contract shape)', () => {
  it('an implementation can save and re-fetch an alert by id', async () => {
    const repository: AmlAlertRepository = new InMemoryAmlAlertRepository();
    const alert = buildAlert();

    await repository.save(alert);
    const found = await repository.findById(alert.id);

    expect(found?.id).toBe(alert.id);
  });

  it('a natural-key-idempotent implementation does not duplicate on repeated save', async () => {
    const repository = new InMemoryAmlAlertRepository();
    const alert = buildAlert();

    await repository.save(alert);
    await repository.save(alert);

    expect((repository as unknown as { byId: Map<string, AmlAlert> }).byId.size).toBe(1);
  });
});
