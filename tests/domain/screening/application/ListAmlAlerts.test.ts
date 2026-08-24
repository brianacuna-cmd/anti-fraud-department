import { oid } from '../../../support/oid.js';
import { createListAmlAlertsUseCase } from '../../../../src/modules/screening/application/ListAmlAlerts.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });
const NO_TENANT = createAuthContext({ userId: oid('admin'), organizationId: null, actorType: 'PLATFORM_ADMIN' });

function buildAlert(id: string, organizationId: string, now = NOW): AmlAlert {
  return AmlAlert.create({
    id: createAmlAlertId(id),
    organizationId,
    customerId: oid('customer-1'),
    entidadSospechosa: 'John Smith',
    confianza: createMatchScore(82),
    fuenteDeteccion: 'index',
    severidad: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid(`entry-${id}`)),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      nombre: 'John Smith',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now,
  });
}

describe('createListAmlAlertsUseCase (compliance inbox)', () => {
  it('lists tenant alerts newest first and hides other organizations', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    await amlAlertRepository.save(buildAlert(oid('older'), ORG_1, NOW));
    await amlAlertRepository.save(buildAlert(oid('newer'), ORG_1, LATER));
    await amlAlertRepository.save(buildAlert(oid('other-org'), ORG_2, LATER));
    const listAmlAlerts = createListAmlAlertsUseCase({ amlAlertRepository });

    const page = await listAmlAlerts({ auth: ANALYST, limit: 20, offset: 0 });

    expect(page.total).toBe(2);
    expect(page.items.map((alert) => String(alert.id))).toEqual([oid('newer'), oid('older')]);
  });

  it('filters by estado', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    await amlAlertRepository.save(buildAlert(oid('open'), ORG_1));
    await amlAlertRepository.save(
      buildAlert(oid('investigating'), ORG_1).transitionTo('INVESTIGATING', LATER),
    );
    const listAmlAlerts = createListAmlAlertsUseCase({ amlAlertRepository });

    const page = await listAmlAlerts({
      auth: ANALYST,
      estado: ['INVESTIGATING'],
      limit: 20,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(String(page.items[0]?.id)).toBe(oid('investigating'));
  });

  it('filters by severidad, watchlist_id, and created_at range combined with AND', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    await amlAlertRepository.save(buildAlert(oid('older'), ORG_1, NOW));
    await amlAlertRepository.save(buildAlert(oid('newer'), ORG_1, LATER));
    const listAmlAlerts = createListAmlAlertsUseCase({ amlAlertRepository });

    const page = await listAmlAlerts({
      auth: ANALYST,
      severidad: ['HIGH'],
      watchlistId: oid('watchlist-1'),
      createdAfter: LATER,
      limit: 20,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(String(page.items[0]?.id)).toBe(oid('newer'));
  });

  it('returns an empty page (not an error) when a filter combination matches nothing', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    await amlAlertRepository.save(buildAlert(oid('only'), ORG_1, NOW));
    const listAmlAlerts = createListAmlAlertsUseCase({ amlAlertRepository });

    const page = await listAmlAlerts({
      auth: ANALYST,
      severidad: ['LOW'],
      limit: 20,
      offset: 0,
    });

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('rejects callers without an organization context', async () => {
    const listAmlAlerts = createListAmlAlertsUseCase({
      amlAlertRepository: new InMemoryAmlAlertRepository(),
    });

    await expect(listAmlAlerts({ auth: NO_TENANT, limit: 20, offset: 0 })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });
});
