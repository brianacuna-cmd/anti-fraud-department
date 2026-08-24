import { oid } from '../../../support/oid.js';
import type { AmlAlertRepository } from '../../../../src/modules/screening/domain/ports/AmlAlertRepository.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
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
    suspectedEntity: 'John Smith',
    confidence: createMatchScore(82),
    detectionSource: 'index',
    severity: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      name: 'John Smith',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

describe('AmlAlertRepository (port contract shape)', () => {
  it('an implementation can save and re-fetch an alert by id', async () => {
    const repository: AmlAlertRepository = new InMemoryAmlAlertRepository();
    const alert = buildAlert();

    await expect(repository.save(alert)).resolves.toBe('inserted');
    const found = await repository.findById(alert.id);

    expect(found?.id).toBe(alert.id);
  });

  it('upserts the same _id and treats a colliding natural key on a new id as duplicate', async () => {
    const repository = new InMemoryAmlAlertRepository();
    const alert = buildAlert();

    await expect(repository.save(alert)).resolves.toBe('inserted');
    await expect(repository.save(alert.transitionTo('INVESTIGATING', NOW))).resolves.toBe('updated');
    await expect(repository.save(buildAlert())).resolves.toBe('duplicate');

    expect(repository.all()).toHaveLength(1);
    expect(repository.all()[0]?.status).toBe('INVESTIGATING');
  });

  it('findByNaturalKey returns the stored alert for the RF-6 key', async () => {
    const repository = new InMemoryAmlAlertRepository();
    const alert = buildAlert();
    await repository.save(alert);

    const found = await repository.findByNaturalKey({
      organizationId: alert.organizationId,
      customerId: alert.customerId,
      entryId: String(alert.matchedEntry.entryId),
      matchField: alert.matchedEntry.matchField,
    });

    expect(found?.id).toBe(alert.id);
  });
});
