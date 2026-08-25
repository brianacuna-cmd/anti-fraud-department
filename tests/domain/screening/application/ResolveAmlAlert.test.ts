import { oid } from '../../../support/oid.js';
import { createResolveAmlAlertUseCase } from '../../../../src/modules/screening/application/ResolveAmlAlert.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlAlertTimelineRecorder } from '../../../helpers/screening/InMemoryAmlAlertTimelineRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';

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

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];

  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

class FailingAuditRecorder implements AuditRecorder {
  async record(): Promise<void> {
    throw new Error('audit write failed');
  }
}

function buildUseCase(auditRecorder: AuditRecorder = new RecordingAuditRecorder()) {
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const timelineRecorder = new InMemoryAmlAlertTimelineRecorder();
  const resolveAmlAlert = createResolveAmlAlertUseCase({
    amlAlertRepository,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId: generateObjectIdHex,
  });
  return { amlAlertRepository, timelineRecorder, resolveAmlAlert };
}

describe('createResolveAmlAlertUseCase', () => {
  it('resolves CONFIRMED_MATCH to RESOLVED and writes exactly one audit row', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, timelineRecorder, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(buildAlert().transitionTo('INVESTIGATING', NOW));

    const alert = await resolveAmlAlert({
      auth: ANALYST,
      alertId: oid('alert-1'),
      verdict: 'CONFIRMED_MATCH',
      justification: 'Matched government ID.',
    });

    expect(alert.status).toBe('RESOLVED');
    expect(amlAlertRepository.all()[0]?.status).toBe('RESOLVED');
    expect(timelineRecorder.all()).toHaveLength(1);
    expect(timelineRecorder.all()[0]).toMatchObject({
      eventType: 'STATE_CHANGED',
      previousValue: 'INVESTIGATING',
      newValue: 'RESOLVED',
    });
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({
      organizationId: ORG_1,
      actorType: 'USER',
      actorId: ANALYST.userId,
      action: 'RESOLVE_AML_ALERT',
      resource: 'aml_alert',
      resourceId: oid('alert-1'),
      detail: { verdict: 'CONFIRMED_MATCH', justification: 'Matched government ID.' },
    });
  });

  it('resolves FALSE_POSITIVE and writes an audit row', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(buildAlert().transitionTo('INVESTIGATING', NOW));

    const alert = await resolveAmlAlert({
      auth: ANALYST,
      alertId: oid('alert-1'),
      verdict: 'FALSE_POSITIVE',
      justification: 'Different date of birth.',
    });

    expect(alert.status).toBe('FALSE_POSITIVE');
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]?.detail).toEqual({
      verdict: 'FALSE_POSITIVE',
      justification: 'Different date of birth.',
    });
  });

  it('rejects an unknown verdict value with no state change and no audit call', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(buildAlert().transitionTo('INVESTIGATING', NOW));

    await expect(
      resolveAmlAlert({
        auth: ANALYST,
        alertId: oid('alert-1'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        verdict: 'BOGUS' as any,
        justification: 'valid text',
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });

    expect(amlAlertRepository.all()[0]?.status).toBe('INVESTIGATING');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('rejects an empty/whitespace justification at the domain layer', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(buildAlert().transitionTo('INVESTIGATING', NOW));

    await expect(
      resolveAmlAlert({
        auth: ANALYST,
        alertId: oid('alert-1'),
        verdict: 'CONFIRMED_MATCH',
        justification: '   ',
      }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' });

    expect(amlAlertRepository.all()[0]?.status).toBe('INVESTIGATING');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('rejects resolving a terminal (RESOLVED) alert with an invalid-transition error', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(
      buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('RESOLVED', NOW),
    );

    await expect(
      resolveAmlAlert({
        auth: ANALYST,
        alertId: oid('alert-1'),
        verdict: 'FALSE_POSITIVE',
        justification: 'valid text',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(amlAlertRepository.all()[0]?.status).toBe('RESOLVED');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('rejects resolving a terminal (FALSE_POSITIVE) alert with an invalid-transition error', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(
      buildAlert().transitionTo('INVESTIGATING', NOW).transitionTo('FALSE_POSITIVE', NOW),
    );

    await expect(
      resolveAmlAlert({
        auth: ANALYST,
        alertId: oid('alert-1'),
        verdict: 'CONFIRMED_MATCH',
        justification: 'valid text',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });

    expect(auditRecorder.events).toHaveLength(0);
  });

  it('rejects a cross-tenant resolve as forbidden, with no audit call', async () => {
    const auditRecorder = new RecordingAuditRecorder();
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(auditRecorder);
    await amlAlertRepository.save(buildAlert(ORG_2).transitionTo('INVESTIGATING', NOW));

    await expect(
      resolveAmlAlert({
        auth: ANALYST,
        alertId: oid('alert-1'),
        verdict: 'CONFIRMED_MATCH',
        justification: 'valid text',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });

    expect(auditRecorder.events).toHaveLength(0);
  });

  it('propagates an audit write failure out of the transaction (atomicity relies on unitOfWork.withTransaction abort)', async () => {
    const { amlAlertRepository, resolveAmlAlert } = buildUseCase(new FailingAuditRecorder());
    await amlAlertRepository.save(buildAlert().transitionTo('INVESTIGATING', NOW));

    await expect(
      resolveAmlAlert({
        auth: ANALYST,
        alertId: oid('alert-1'),
        verdict: 'CONFIRMED_MATCH',
        justification: 'valid text',
      }),
    ).rejects.toThrow('audit write failed');
  });
});
