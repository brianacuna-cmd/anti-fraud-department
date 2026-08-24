import { oid } from '../../../support/oid.js';
import { createGetAmlAlertUseCase } from '../../../../src/modules/screening/application/GetAmlAlert.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { ScreeningError } from '../../../../src/modules/screening/domain/errors/ScreeningError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

function buildAlert(organizationId = ORG_1): AmlAlert {
  return AmlAlert.create({
    id: createAmlAlertId(oid('alert-1')),
    organizationId,
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

describe('createGetAmlAlertUseCase', () => {
  it('returns the alert for the owning tenant', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    await amlAlertRepository.save(buildAlert());
    const getAmlAlert = createGetAmlAlertUseCase({ amlAlertRepository });

    const alert = await getAmlAlert({ auth: ANALYST, alertId: oid('alert-1') });

    expect(String(alert.id)).toBe(oid('alert-1'));
    expect(alert.organizationId).toBe(ORG_1);
  });

  it('throws amlAlertNotFound when the alert does not exist', async () => {
    const getAmlAlert = createGetAmlAlertUseCase({
      amlAlertRepository: new InMemoryAmlAlertRepository(),
    });

    await expect(getAmlAlert({ auth: ANALYST, alertId: oid('missing') })).rejects.toBeInstanceOf(
      ScreeningError,
    );
    await expect(getAmlAlert({ auth: ANALYST, alertId: oid('missing') })).rejects.toMatchObject({
      code: 'AML_ALERT_NOT_FOUND',
    });
  });

  it('throws forbiddenCrossTenant for an alert in another organization', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    await amlAlertRepository.save(buildAlert(ORG_2));
    const getAmlAlert = createGetAmlAlertUseCase({ amlAlertRepository });

    await expect(getAmlAlert({ auth: ANALYST, alertId: oid('alert-1') })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });
});
