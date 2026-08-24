import { oid } from '../../../support/oid.js';
import { createOpenAmlAlertUseCase, AML_ALERT_CREATED } from '../../../../src/modules/screening/application/OpenAmlAlert.js';
import { generateAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlExpedienteTimelineRecorder } from '../../../helpers/screening/InMemoryAmlExpedienteTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const AUTH = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
});

function buildMatch(overrides: { name?: string; riskLevel?: string | null; entryId?: string } = {}) {
  return createScreeningMatch({
    entryId: createWatchlistEntryId(overrides.entryId ?? oid('entry-1')),
    watchlistId: createWatchlistId(oid('watchlist-1')),
    name: overrides.name ?? 'John Smith',
    document: '123456789',
    riskLevel: overrides.riskLevel === undefined ? 'HIGH' : overrides.riskLevel,
    matchField: 'NAME',
    algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
  });
}

function buildUseCase() {
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const timelineRecorder = new InMemoryAmlExpedienteTimelineRecorder();
  const outbox = new InMemoryOutboxEventRepository();
  const openAmlAlert = createOpenAmlAlertUseCase({
    amlAlertRepository,
    timelineRecorder,
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateAmlAlertId,
    generateTimelineEventId: generateObjectIdHex,
    generateOutboxEventId,
  });
  return { openAmlAlert, amlAlertRepository, timelineRecorder, outbox };
}

describe('createOpenAmlAlertUseCase', () => {
  it('does nothing when confidence is below the configured alert threshold', async () => {
    const { openAmlAlert, amlAlertRepository, timelineRecorder, outbox } = buildUseCase();

    const result = await openAmlAlert({
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch(),
      confidence: createMatchScore(40),
    });

    expect(result).toEqual({ opened: false, duplicate: false, alert: null });
    expect(amlAlertRepository.all()).toHaveLength(0);
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(outbox.all()).toHaveLength(0);
  });

  it('opens an OPEN expediente with calculated severity, CASE_CREATED timeline, and AML_ALERT_CREATED outbox', async () => {
    const { openAmlAlert, amlAlertRepository, timelineRecorder, outbox } = buildUseCase();

    const result = await openAmlAlert({
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch({ riskLevel: 'HIGH' }),
      confidence: createMatchScore(82),
    });

    expect(result.opened).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.alert?.status).toBe('OPEN');
    expect(result.alert?.severity).toBe('HIGH');
    expect(amlAlertRepository.all()).toHaveLength(1);

    const timeline = timelineRecorder.all();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('CASE_CREATED');
    expect(timeline[0]?.newValue).toBe('OPEN');
    expect(timeline[0]?.caseId).toBe(String(result.alert?.id));
    expect(timeline[0]?.createdBy).toBe(AUTH.userId);

    const events = outbox.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(AML_ALERT_CREATED);
    expect(events[0]?.aggregateType).toBe('aml_alerts');
    expect(events[0]?.aggregateId).toBe(String(result.alert?.id));
    expect(events[0]?.payload).toMatchObject({
      status: 'OPEN',
      severity: 'HIGH',
      confidence: 82,
    });
  });

  it('calculates MEDIUM severity for ALERT_ONLY confidence when the entry has no higher riskLevel', async () => {
    const { openAmlAlert } = buildUseCase();

    const result = await openAmlAlert({
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch({ riskLevel: null }),
      confidence: createMatchScore(55),
    });

    expect(result.opened).toBe(true);
    expect(result.alert?.severity).toBe('MEDIUM');
  });

  it('is idempotent on the natural key: duplicate save skips timeline and outbox', async () => {
    const { openAmlAlert, amlAlertRepository, timelineRecorder, outbox } = buildUseCase();
    const input = {
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch(),
      confidence: createMatchScore(82),
    };

    const first = await openAmlAlert(input);
    const second = await openAmlAlert(input);

    expect(first.opened).toBe(true);
    expect(second.opened).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.alert?.id).toBe(first.alert?.id);
    expect(amlAlertRepository.all()).toHaveLength(1);
    expect(timelineRecorder.all()).toHaveLength(1);
    expect(outbox.all()).toHaveLength(1);
  });

  it('uses per-call thresholds so an org with a lower cutoff still opens', async () => {
    const { openAmlAlert } = buildUseCase();

    const result = await openAmlAlert({
      auth: AUTH,
      customerId: oid('customer-1'),
      match: buildMatch({ riskLevel: null }),
      confidence: createMatchScore(40),
      thresholds: { alertThreshold: 30, signalThreshold: 80 },
    });

    expect(result.opened).toBe(true);
    expect(result.alert?.severity).toBe('MEDIUM');
  });

  it('rejects a missing tenant context', async () => {
    const { openAmlAlert } = buildUseCase();

    await expect(
      openAmlAlert({
        auth: createAuthContext({ userId: oid('admin-1'), organizationId: null, actorType: 'PLATFORM_ADMIN' }),
        customerId: oid('customer-1'),
        match: buildMatch(),
        confidence: createMatchScore(82),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
