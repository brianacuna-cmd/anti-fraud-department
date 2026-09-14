import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlAlertTimelineRecorder } from '../../../helpers/screening/InMemoryAmlAlertTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createOpenAmlAlertUseCase } from '../../../../src/modules/screening/application/OpenAmlAlert.js';
import {
  OFFICIAL_LIST_MIN_CONFIDENCE,
  createScreenSubjectAgainstWatchlistUseCase,
} from '../../../../src/modules/screening/application/ScreenSubjectAgainstWatchlist.js';
import { generateAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type { WatchlistCandidate } from '../../../../src/modules/screening/domain/ports/WatchlistCandidateRepository.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';

const ORG = oid('org-1');
const AUTH = createAuthContext({ userId: 'system:customer-rescreen', organizationId: ORG, actorType: 'ORGANIZATION' });

/*
 * "John Smith" is fully contained in this name (2 of its 6 words), so it
 * scores round(100 * (0.5 * 1 + 0.5 * 2/6)) = 67: above the default alert
 * threshold (50), below the signal threshold (70) and the official floor (85).
 */
const MID_CONFIDENCE_NAME = 'John Smith Abdul Rahman Al Khalil';

const candidate = (name: string, fromOfficialList: boolean): WatchlistCandidate => ({
  id: createWatchlistEntryId(oid(`entry-${name}`)),
  watchlistId: createWatchlistId(oid('watchlist-1')),
  name,
  document: null,
  walletAddress: null,
  riskLevel: 'CRITICAL',
  normalizedName: name.toLowerCase(),
  phoneticKeys: [],
  country: null,
  fromOfficialList,
});

/** Deterministic engine: a word is its own phonetic key and only equal words are alike. */
function build(candidates: WatchlistCandidate[]) {
  const alerts = new InMemoryAmlAlertRepository();
  const openAmlAlert = createOpenAmlAlertUseCase({
    amlAlertRepository: alerts,
    timelineRecorder: new InMemoryAmlAlertTimelineRecorder(),
    outbox: new InMemoryOutboxEventRepository(),
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(fromDate(new Date('2026-09-11T06:00:00.000Z'))),
    generateAmlAlertId,
    generateTimelineEventId: generateObjectIdHex,
    generateOutboxEventId,
  });
  const screenSubject = createScreenSubjectAgainstWatchlistUseCase({
    watchlistCandidateRepository: { findCandidates: async () => candidates },
    openAmlAlert,
    phoneticEncoder: { encode: (token) => [token] },
    similarityCalculator: { jaroWinkler: (a, b) => (a === b ? 1 : 0.2), levenshtein: () => 0 },
  });
  return { screenSubject, alerts };
}

const screenJohnSmith = (screenSubject: ReturnType<typeof build>['screenSubject']) =>
  screenSubject({ auth: AUTH, customerId: 'customer-1', entryType: 'PERSON', name: 'John Smith' });

describe(`ScreenSubjectAgainstWatchlist — official list floor (${OFFICIAL_LIST_MIN_CONFIDENCE})`, () => {
  it('drops a mid-confidence match against an official list instead of alerting', async () => {
    const { screenSubject, alerts } = build([candidate(MID_CONFIDENCE_NAME, true)]);

    const result = await screenJohnSmith(screenSubject);

    expect(result.matches[0]).toEqual(expect.objectContaining({ confidence: 67, tier: 'DISCARD' }));
    expect(alerts.all()).toHaveLength(0);
  });

  it('keeps the organization thresholds for its own lists, without inheriting CRITICAL on a weak match', async () => {
    const { screenSubject, alerts } = build([candidate(MID_CONFIDENCE_NAME, false)]);

    const result = await screenJohnSmith(screenSubject);

    expect(result.matches[0]).toEqual(expect.objectContaining({ confidence: 67, tier: 'ALERT_ONLY' }));
    expect(alerts.all().map((alert) => alert.severity)).toEqual(['MEDIUM']);
  });

  it('alerts a strong official match at the list risk level', async () => {
    const { screenSubject, alerts } = build([candidate('John Smith', true)]);

    const result = await screenJohnSmith(screenSubject);

    expect(result.matches[0]).toEqual(expect.objectContaining({ confidence: 100, tier: 'ALERT_AND_SIGNAL' }));
    expect(alerts.all().map((alert) => alert.severity)).toEqual(['CRITICAL']);
  });
});
