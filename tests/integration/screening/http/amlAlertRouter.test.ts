import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { oid } from '../../../support/oid.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { screeningErrorStatus } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/errorStatus.js';
import { amlAlertRouter } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/amlAlertRouter.js';
import { createListAmlAlertsUseCase } from '../../../../src/modules/screening/application/ListAmlAlerts.js';
import { createGetAmlAlertUseCase } from '../../../../src/modules/screening/application/GetAmlAlert.js';
import { createGetAmlAlertTimelineUseCase } from '../../../../src/modules/screening/application/GetAmlAlertTimeline.js';
import { createTransitionAmlAlertUseCase } from '../../../../src/modules/screening/application/TransitionAmlAlert.js';
import { createEscalateAmlAlertUseCase } from '../../../../src/modules/screening/application/EscalateAmlAlert.js';
import { AmlAlert } from '../../../../src/modules/screening/domain/model/aggregates/AmlAlert.js';
import { createAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createMatchScore } from '../../../../src/modules/screening/domain/model/value-objects/MatchScore.js';
import { createScreeningMatch } from '../../../../src/modules/screening/domain/model/entities/ScreeningMatch.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlExpedienteTimelineRecorder } from '../../../helpers/screening/InMemoryAmlExpedienteTimelineRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ORG_1_ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
});
const CASE_ID = oid('fraud-case-1');

function buildAlert(id: string, organizationId = ORG_1): AmlAlert {
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
    now: NOW,
  });
}

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_ANALYST) {
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const timelineRecorder = new InMemoryAmlExpedienteTimelineRecorder();
  const getAmlAlert = createGetAmlAlertUseCase({ amlAlertRepository });
  const router = amlAlertRouter({
    listAmlAlerts: createListAmlAlertsUseCase({ amlAlertRepository }),
    getAmlAlert,
    getAmlAlertTimeline: createGetAmlAlertTimelineUseCase({ getAmlAlert, timelineRecorder }),
    transitionAmlAlert: createTransitionAmlAlertUseCase({
      amlAlertRepository,
      timelineRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateTimelineEventId: generateObjectIdHex,
    }),
    escalateAmlAlert: createEscalateAmlAlertUseCase({
      amlAlertRepository,
      caseOpener: { open: async () => ({ caseId: CASE_ID }) },
      timelineRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateTimelineEventId: generateObjectIdHex,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }

  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(screeningErrorStatus),
  });

  return { app, amlAlertRepository, timelineRecorder };
}

describe('GET /api/v1/aml-alerts (compliance inbox)', () => {
  it('returns a tenant-scoped page of alerts', async () => {
    const { app, amlAlertRepository } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('inbox-open')));
    await amlAlertRepository.save(buildAlert(oid('inbox-other-org'), ORG_2));

    const response = await request(app).get('/api/v1/aml-alerts').query({ estado: 'OPEN' });

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].id).toBe(oid('inbox-open'));
    expect(response.body.items[0].estado).toBe('OPEN');
    expect(response.body.items[0].caseId).toBeNull();
  });

  it('returns 400 for invalid query params', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/v1/aml-alerts').query({ limit: '0' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
  });
});

describe('GET /api/v1/aml-alerts/:alertId', () => {
  it('returns 404 when missing and 403 for another tenant', async () => {
    const { app, amlAlertRepository } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('foreign'), ORG_2));

    const missing = await request(app).get(`/api/v1/aml-alerts/${oid('missing')}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('AML_ALERT_NOT_FOUND');

    const foreign = await request(app).get(`/api/v1/aml-alerts/${oid('foreign')}`);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });
});

describe('AML alert triage', () => {
  it('investigates, then resolves as FALSE_POSITIVE without a Case', async () => {
    const { app, amlAlertRepository } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('fp-alert')));

    const investigating = await request(app).post(`/api/v1/aml-alerts/${oid('fp-alert')}/investigate`);
    expect(investigating.status).toBe(200);
    expect(investigating.body.estado).toBe('INVESTIGATING');

    const timeline = await request(app).get(`/api/v1/aml-alerts/${oid('fp-alert')}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'STATE_CHANGED', newValue: 'INVESTIGATING' }),
      ]),
    );

    const resolved = await request(app)
      .post(`/api/v1/aml-alerts/${oid('fp-alert')}/resolve`)
      .send({ outcome: 'FALSE_POSITIVE' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.estado).toBe('FALSE_POSITIVE');
    expect(resolved.body.caseId).toBeNull();
  });

  it('returns 422 when resolving an OPEN alert', async () => {
    const { app, amlAlertRepository } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('still-open')));

    const response = await request(app)
      .post(`/api/v1/aml-alerts/${oid('still-open')}/resolve`)
      .send({ outcome: 'RESOLVED' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('escalates an OPEN alert to a fraud Case and keeps the AML lifecycle independent', async () => {
    const { app, amlAlertRepository, timelineRecorder } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('escalate-me')));

    const response = await request(app).post(`/api/v1/aml-alerts/${oid('escalate-me')}/escalate`);

    expect(response.status).toBe(200);
    expect(response.body.estado).toBe('INVESTIGATING');
    expect(response.body.caseId).toBe(CASE_ID);
    expect(response.body.alreadyEscalated).toBe(false);

    const again = await request(app).post(`/api/v1/aml-alerts/${oid('escalate-me')}/escalate`);
    expect(again.status).toBe(200);
    expect(again.body.alreadyEscalated).toBe(true);
    expect(timelineRecorder.all()).toHaveLength(1);
  });
});
