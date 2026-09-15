import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlAlertTimelineRecorder } from '../../../helpers/screening/InMemoryAmlAlertTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createOpenAmlAlertUseCase } from '../../../../src/modules/screening/application/OpenAmlAlert.js';
import { createEscalateAmlAlertUseCase } from '../../../../src/modules/screening/application/EscalateAmlAlert.js';
import { createEscalatingOpenAmlAlert } from '../../../../src/modules/screening/application/EscalatingOpenAmlAlert.js';
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

function match() {
  return createScreeningMatch({
    entryId: generateWatchlistEntryId(),
    watchlistId: generateWatchlistId(),
    name: 'Juan Carlos PEREZ GOMEZ',
    document: null,
    riskLevel: 'CRITICAL',
    matchField: createMatchField('NAME'),
    algorithm: 'JARO_WINKLER',
  });
}

function build(options: { failOpen?: boolean } = {}) {
  const alerts = new InMemoryAmlAlertRepository();
  const clock = new FixedClock(NOW);
  const unitOfWork = new PassthroughUnitOfWork();
  const openAmlAlert = createOpenAmlAlertUseCase({
    amlAlertRepository: alerts,
    timelineRecorder: new InMemoryAmlAlertTimelineRecorder(),
    outbox: new InMemoryOutboxEventRepository(),
    unitOfWork,
    clock,
    generateAmlAlertId,
    generateTimelineEventId: generateObjectIdHex,
    generateOutboxEventId,
  });
  const open = jest.fn(async () => {
    if (options.failOpen === true) throw new Error('case store down');
    return { caseId: CASE_ID };
  });
  const escalateAmlAlert = createEscalateAmlAlertUseCase({
    amlAlertRepository: alerts,
    caseOpener: { open },
    timelineRecorder: new InMemoryAmlAlertTimelineRecorder(),
    unitOfWork,
    clock,
    generateTimelineEventId: generateObjectIdHex,
  });
  const onEscalationError = jest.fn();
  const openAndEscalate = createEscalatingOpenAmlAlert({ openAmlAlert, escalateAmlAlert, onEscalationError });
  return { openAndEscalate, alerts, open, onEscalationError };
}

describe('createEscalatingOpenAmlAlert', () => {
  it('opens a case for a strong match and leaves the alert linked and INVESTIGATING', async () => {
    const { openAndEscalate, alerts, open } = build();

    const result = await openAndEscalate({ auth: AUTH, customerId: CUSTOMER, match: match(), confidence: createMatchScore(92) });

    expect(result.alert?.caseId).toBe(CASE_ID);
    expect(result.alert?.status).toBe('INVESTIGATING');
    expect(alerts.all().map((a) => a.caseId)).toEqual([CASE_ID]);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ customerId: CUSTOMER, tags: expect.arrayContaining(['AML']) }));
  });

  it('keeps a doubtful match in the inbox, unlinked', async () => {
    const { openAndEscalate, alerts, open } = build();

    await openAndEscalate({ auth: AUTH, customerId: CUSTOMER, match: match(), confidence: createMatchScore(60) });

    expect(alerts.all().map((a) => [a.caseId, a.status])).toEqual([[null, 'OPEN']]);
    expect(open).not.toHaveBeenCalled();
  });

  it('honours the org thresholds passed with the match', async () => {
    const { openAndEscalate, open } = build();

    await openAndEscalate({
      auth: AUTH,
      customerId: CUSTOMER,
      match: match(),
      confidence: createMatchScore(80),
      thresholds: { alertThreshold: 60, signalThreshold: 85 },
    });

    expect(open).not.toHaveBeenCalled();
  });

  it('returns the opened alert and reports the error when escalation fails', async () => {
    const { openAndEscalate, onEscalationError } = build({ failOpen: true });

    const result = await openAndEscalate({ auth: AUTH, customerId: CUSTOMER, match: match(), confidence: createMatchScore(95) });

    expect(result.opened).toBe(true);
    expect(result.alert?.caseId).toBeNull();
    expect(onEscalationError).toHaveBeenCalledTimes(1);
  });
});
