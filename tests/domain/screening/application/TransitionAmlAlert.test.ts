import { oid } from '../../../support/oid.js';
import { createTransitionAmlAlertUseCase } from '../../../../src/modules/screening/application/TransitionAmlAlert.js';
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
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

function buildAlert(organizationId = ORG_1): AmlAlert {
  return AmlAlert.create({
    id: createAmlAlertId(oid('alert-1')),
    organizationId,
    customerId: oid('customer-1'),
    entidadSospechosa: 'John Smith',
    confianza: createMatchScore(82),
    fuenteDeteccion: 'index',
    severidad: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid('entry-1')),
      watchlistId: createWatchlistId(oid('watchlist-1')),
      nombre: 'John Smith',
      matchField: 'NAME',
      algorithm: 'JARO_WINKLER_DOUBLE_METAPHONE',
    }),
    now: NOW,
  });
}

function buildUseCase() {
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const timelineRecorder = new InMemoryAmlExpedienteTimelineRecorder();
  const transitionAmlAlert = createTransitionAmlAlertUseCase({
    amlAlertRepository,
    timelineRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId: generateObjectIdHex,
  });
  return { amlAlertRepository, timelineRecorder, transitionAmlAlert };
}

describe('createTransitionAmlAlertUseCase', () => {
  it('moves OPEN → INVESTIGATING and appends STATE_CHANGED keyed by the alert id', async () => {
    const { amlAlertRepository, timelineRecorder, transitionAmlAlert } = buildUseCase();
    await amlAlertRepository.save(buildAlert());

    const alert = await transitionAmlAlert({
      auth: ANALYST,
      alertId: oid('alert-1'),
      next: 'INVESTIGATING',
    });

    expect(alert.estado).toBe('INVESTIGATING');
    expect(amlAlertRepository.all()[0]?.estado).toBe('INVESTIGATING');
    expect(timelineRecorder.all()).toHaveLength(1);
    expect(timelineRecorder.all()[0]).toMatchObject({
      caseId: oid('alert-1'),
      eventType: 'STATE_CHANGED',
      previousValue: 'OPEN',
      newValue: 'INVESTIGATING',
      createdBy: ANALYST.userId,
    });
  });

  it('resolves INVESTIGATING → FALSE_POSITIVE without creating a Case', async () => {
    const { amlAlertRepository, transitionAmlAlert } = buildUseCase();
    await amlAlertRepository.save(buildAlert().transitionTo('INVESTIGATING', NOW));

    const alert = await transitionAmlAlert({
      auth: ANALYST,
      alertId: oid('alert-1'),
      next: 'FALSE_POSITIVE',
    });

    expect(alert.estado).toBe('FALSE_POSITIVE');
    expect(alert.caseId).toBeNull();
  });

  it('rejects OPEN → RESOLVED (must investigate first)', async () => {
    const { amlAlertRepository, transitionAmlAlert } = buildUseCase();
    await amlAlertRepository.save(buildAlert());

    await expect(
      transitionAmlAlert({ auth: ANALYST, alertId: oid('alert-1'), next: 'RESOLVED' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('throws forbiddenCrossTenant for another organization', async () => {
    const { amlAlertRepository, transitionAmlAlert } = buildUseCase();
    await amlAlertRepository.save(buildAlert(ORG_2));

    await expect(
      transitionAmlAlert({ auth: ANALYST, alertId: oid('alert-1'), next: 'INVESTIGATING' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
