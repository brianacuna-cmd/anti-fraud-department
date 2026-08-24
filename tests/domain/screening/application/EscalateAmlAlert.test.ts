import { oid } from '../../../support/oid.js';
import {
  createEscalateAmlAlertUseCase,
  type AmlAlertCaseOpener,
} from '../../../../src/modules/screening/application/EscalateAmlAlert.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlExpedienteTimelineRecorder } from '../../../helpers/screening/InMemoryAmlExpedienteTimelineRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });
const CASE_ID = oid('fraud-case-1');

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

function buildUseCase(opener: AmlAlertCaseOpener = { open: async () => ({ caseId: CASE_ID }) }) {
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const timelineRecorder = new InMemoryAmlExpedienteTimelineRecorder();
  const escalateAmlAlert = createEscalateAmlAlertUseCase({
    amlAlertRepository,
    caseOpener: opener,
    timelineRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId: generateObjectIdHex,
  });
  return { amlAlertRepository, timelineRecorder, escalateAmlAlert, opener };
}

describe('createEscalateAmlAlertUseCase', () => {
  it('opens a fraud Case, links it, and moves OPEN → INVESTIGATING without closing the alert', async () => {
    const opened: Array<Parameters<AmlAlertCaseOpener['open']>[0]> = [];
    const { amlAlertRepository, timelineRecorder, escalateAmlAlert } = buildUseCase({
      open: async (input) => {
        opened.push(input);
        return { caseId: CASE_ID };
      },
    });
    await amlAlertRepository.save(buildAlert());

    const result = await escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') });

    expect(result.alreadyEscalated).toBe(false);
    expect(result.caseId).toBe(CASE_ID);
    expect(result.alert.status).toBe('INVESTIGATING');
    expect(result.alert.caseId).toBe(CASE_ID);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      customerId: oid('customer-1'),
      riskScore: 82,
      priority: 'HIGH',
      tags: ['AML', 'WATCHLIST_MATCH'],
      idempotencyKey: oid('alert-1'),
    });
    expect(timelineRecorder.all()[0]).toMatchObject({
      eventType: 'STATE_CHANGED',
      previousValue: 'OPEN',
      newValue: 'INVESTIGATING',
    });
  });

  it('is idempotent when the alert is already linked — does not open another Case', async () => {
    let openCalls = 0;
    const { amlAlertRepository, escalateAmlAlert } = buildUseCase({
      open: async () => {
        openCalls += 1;
        return { caseId: CASE_ID };
      },
    });
    await amlAlertRepository.save(buildAlert().linkCase(CASE_ID, NOW));

    const result = await escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') });

    expect(result.alreadyEscalated).toBe(true);
    expect(result.caseId).toBe(CASE_ID);
    expect(openCalls).toBe(0);
  });

  it('does not open a Case for a FALSE_POSITIVE', async () => {
    let openCalls = 0;
    const { amlAlertRepository, escalateAmlAlert } = buildUseCase({
      open: async () => {
        openCalls += 1;
        return { caseId: CASE_ID };
      },
    });
    await amlAlertRepository.save(
      buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('FALSE_POSITIVE', NOW),
    );

    await expect(escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') })).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(openCalls).toBe(0);
    expect(amlAlertRepository.all()[0]?.caseId).toBeNull();
  });

  it('persists the case link before the timeline step, so a retry after a timeline failure does not open a second Case', async () => {
    let openCalls = 0;
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    const throwingTimeline = {
      record: async () => {
        throw new Error('timeline write failed');
      },
      listByAlertId: async () => [],
    };
    const escalateAmlAlert = createEscalateAmlAlertUseCase({
      amlAlertRepository,
      caseOpener: {
        open: async () => {
          openCalls += 1;
          return { caseId: CASE_ID };
        },
      },
      timelineRecorder: throwingTimeline,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateTimelineEventId: generateObjectIdHex,
    });
    await amlAlertRepository.save(buildAlert());

    // First attempt: case is opened + linked, but the timeline step throws.
    await expect(escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') })).rejects.toThrow(
      'timeline write failed',
    );
    // The caseId is already durable despite the failure.
    expect(amlAlertRepository.all()[0]?.caseId).toBe(CASE_ID);

    // Retry: must NOT open a second Case — it short-circuits on the saved caseId.
    const retry = await escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') });
    expect(retry.alreadyEscalated).toBe(true);
    expect(retry.caseId).toBe(CASE_ID);
    expect(openCalls).toBe(1);
  });

  it('forwards the alert id as idempotencyKey so a retry after the case was created (but a later step failed) returns the SAME case instead of opening a second one', async () => {
    // Fake opener that dedups by idempotencyKey, mirroring an idempotent
    // CreateCase: same key across calls => same caseId, no new case opened.
    const casesByKey = new Map<string, string>();
    let distinctCasesOpened = 0;
    const dedupingOpener: AmlAlertCaseOpener = {
      open: async (input) => {
        const key = input.idempotencyKey;
        if (key !== undefined && casesByKey.has(key)) {
          return { caseId: casesByKey.get(key)! };
        }
        distinctCasesOpened += 1;
        const caseId = oid(`fraud-case-${distinctCasesOpened}`);
        if (key !== undefined) {
          casesByKey.set(key, caseId);
        }
        return { caseId };
      },
    };
    const amlAlertRepository = new InMemoryAmlAlertRepository();
    const throwingTimeline = {
      record: async () => {
        throw new Error('timeline write failed');
      },
      listByAlertId: async () => [],
    };
    const escalateAmlAlert = createEscalateAmlAlertUseCase({
      amlAlertRepository,
      caseOpener: dedupingOpener,
      timelineRecorder: throwingTimeline,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateTimelineEventId: generateObjectIdHex,
    });
    await amlAlertRepository.save(buildAlert());

    await expect(escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') })).rejects.toThrow(
      'timeline write failed',
    );
    const firstCaseId = amlAlertRepository.all()[0]?.caseId;
    expect(firstCaseId).not.toBeNull();

    // Simulate a NEW alert instance re-attempting escalation from scratch
    // (e.g. the caseId link save had also failed) — the opener is still
    // called with the SAME idempotencyKey (the alert id), so it must dedup.
    const opened = await dedupingOpener.open({
      auth: ANALYST,
      customerId: oid('customer-1'),
      riskScore: 82,
      priority: 'HIGH',
      idempotencyKey: oid('alert-1'),
    });

    expect(opened.caseId).toBe(firstCaseId);
    expect(distinctCasesOpened).toBe(1);
  });

  it('leaves the alert OPEN when CreateCase fails', async () => {
    const { amlAlertRepository, escalateAmlAlert } = buildUseCase({
      open: async () => {
        throw new Error('no fraud config');
      },
    });
    await amlAlertRepository.save(buildAlert());

    await expect(escalateAmlAlert({ auth: ANALYST, alertId: oid('alert-1') })).rejects.toThrow(
      'no fraud config',
    );
    expect(amlAlertRepository.all()[0]?.status).toBe('OPEN');
    expect(amlAlertRepository.all()[0]?.caseId).toBeNull();
  });
});
