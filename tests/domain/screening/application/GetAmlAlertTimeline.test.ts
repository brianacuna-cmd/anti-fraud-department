import { oid } from '../../../support/oid.js';
import { createGetAmlAlertUseCase } from '../../../../src/modules/screening/application/GetAmlAlert.js';
import { createGetAmlAlertTimelineUseCase } from '../../../../src/modules/screening/application/GetAmlAlertTimeline.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlAlertTimelineRecorder } from '../../../helpers/screening/InMemoryAmlAlertTimelineRecorder.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

function buildAlert(): AmlAlert {
  return AmlAlert.create({
    id: createAmlAlertId(oid('alert-1')),
    organizationId: ORG_1,
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

describe('createGetAmlAlertTimelineUseCase', () => {
  it('returns oldest-first timeline rows keyed by the alert id', async () => {
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    const timelineRecorder = new InMemoryAmlAlertTimelineRecorder();
    const alert = buildAlert();
    await amlAlertRepository.save(alert);
    await timelineRecorder.record({
      id: generateObjectIdHex(),
      caseId: String(alert.id),
      eventType: 'CASE_CREATED',
      previousValue: null,
      newValue: 'OPEN',
      createdBy: null,
      createdAt: NOW,
    });
    await timelineRecorder.record({
      id: generateObjectIdHex(),
      caseId: String(alert.id),
      eventType: 'STATE_CHANGED',
      previousValue: 'OPEN',
      newValue: 'INVESTIGATING',
      createdBy: ANALYST.userId,
      createdAt: LATER,
    });
    const getAmlAlertTimeline = createGetAmlAlertTimelineUseCase({
      getAmlAlert: createGetAmlAlertUseCase({ amlAlertRepository }),
      timelineRecorder,
    });

    const events = await getAmlAlertTimeline({ auth: ANALYST, alertId: oid('alert-1') });

    expect(events.map((event) => event.eventType)).toEqual(['CASE_CREATED', 'STATE_CHANGED']);
    expect(events[0]?.newValue).toBe('OPEN');
    expect(events[1]?.newValue).toBe('INVESTIGATING');
  });

  it('throws when the alert is missing', async () => {
    const getAmlAlertTimeline = createGetAmlAlertTimelineUseCase({
      getAmlAlert: createGetAmlAlertUseCase({ amlAlertRepository: new InMemoryAmlAlertRepository() }),
      timelineRecorder: new InMemoryAmlAlertTimelineRecorder(),
    });

    await expect(
      getAmlAlertTimeline({ auth: ANALYST, alertId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'AML_ALERT_NOT_FOUND' });
  });
});
