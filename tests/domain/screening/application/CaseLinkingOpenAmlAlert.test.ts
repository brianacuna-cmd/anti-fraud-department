import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlAlertTimelineRecorder } from '../../../helpers/screening/InMemoryAmlAlertTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createOpenAmlAlertUseCase } from '../../../../src/modules/screening/application/OpenAmlAlert.js';
import { createCaseLinkingOpenAmlAlert } from '../../../../src/modules/screening/application/CaseLinkingOpenAmlAlert.js';
import { generateAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { createMatchField } from '../../../../src/modules/screening/domain/model/value-objects/MatchField.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';

const ORG = oid('org-1');
const CUSTOMER = 'customer-1';
const CASE_ID = oid('case-1');
const NOW = fromDate(new Date('2026-09-11T06:00:00.000Z'));
const AUTH = createAuthContext({ userId: 'system:customer-rescreen', organizationId: ORG, actorType: 'ORGANIZATION' });

const MATCH = createScreeningMatch({
  entryId: generateWatchlistEntryId(),
  watchlistId: generateWatchlistId(),
  name: 'Juan Carlos PEREZ GOMEZ',
  document: null,
  riskLevel: 'CRITICAL',
  matchField: createMatchField('NAME'),
  algorithm: 'JARO_WINKLER',
});

function build(caseId: string | null) {
  const alerts = new InMemoryAmlAlertRepository();
  const clock = new FixedClock(NOW);
  const openAmlAlert = createOpenAmlAlertUseCase({
    amlAlertRepository: alerts,
    timelineRecorder: new InMemoryAmlAlertTimelineRecorder(),
    outbox: new InMemoryOutboxEventRepository(),
    unitOfWork: new PassthroughUnitOfWork(),
    clock,
    generateAmlAlertId,
    generateTimelineEventId: generateObjectIdHex,
    generateOutboxEventId,
  });
  const find = jest.fn(async () => caseId);
  const openAndLink = createCaseLinkingOpenAmlAlert({
    openAmlAlert,
    caseLinker: { find },
    amlAlertRepository: alerts,
    unitOfWork: new PassthroughUnitOfWork(),
    clock,
  });
  return { openAndLink, alerts, find };
}

describe('createCaseLinkingOpenAmlAlert', () => {
  it("links a newly opened alert to the customer's open case", async () => {
    const { openAndLink, alerts, find } = build(CASE_ID);

    const result = await openAndLink({ auth: AUTH, customerId: CUSTOMER, match: MATCH, confidence: createMatchScore(95) });

    expect(result.opened).toBe(true);
    expect(result.alert!.caseId).toBe(CASE_ID);
    expect(alerts.all().map((alert) => alert.caseId)).toEqual([CASE_ID]);
    expect(find).toHaveBeenCalledWith(ORG, CUSTOMER);
  });

  it('leaves the alert unlinked when the customer has no open case', async () => {
    const { openAndLink, alerts } = build(null);

    await openAndLink({ auth: AUTH, customerId: CUSTOMER, match: MATCH, confidence: createMatchScore(95) });

    expect(alerts.all().map((alert) => alert.caseId)).toEqual([null]);
  });

  it('does not look up a case again for a duplicate alert', async () => {
    const { openAndLink, find } = build(CASE_ID);
    const input = { auth: AUTH, customerId: CUSTOMER, match: MATCH, confidence: createMatchScore(95) };

    await openAndLink(input);
    const second = await openAndLink(input);

    expect(second.duplicate).toBe(true);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the match is below the alert threshold', async () => {
    const { openAndLink, alerts, find } = build(CASE_ID);

    const result = await openAndLink({ auth: AUTH, customerId: CUSTOMER, match: MATCH, confidence: createMatchScore(10) });

    expect(result.opened).toBe(false);
    expect(alerts.all()).toHaveLength(0);
    expect(find).not.toHaveBeenCalled();
  });
});
