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
import { createResolveAmlAlertUseCase } from '../../../../src/modules/screening/application/ResolveAmlAlert.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
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
    suspectedEntity: 'John Smith',
    confidence: createMatchScore(82),
    detectionSource: 'index',
    severity: 'HIGH',
    matchedEntry: createScreeningMatch({
      entryId: createWatchlistEntryId(oid(`entry-${id}`)),
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

  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function buildApp(actorPerRequest: () => AuthContext = () => ORG_1_ANALYST) {
  const amlAlertRepository = new InMemoryAmlAlertRepository();
  const timelineRecorder = new InMemoryAmlExpedienteTimelineRecorder();
  const auditRecorder = new RecordingAuditRecorder();
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
    resolveAmlAlert: createResolveAmlAlertUseCase({
      amlAlertRepository,
      timelineRecorder,
      auditRecorder,
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

  return { app, amlAlertRepository, timelineRecorder, auditRecorder };
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
  it('investigates, then resolves as FALSE_POSITIVE without a Case, writing an audit row', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
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
      .patch(`/api/v1/aml-alerts/${oid('fp-alert')}/resolve`)
      .send({ dictamen: 'FALSE_POSITIVE', justificacion: 'Different date of birth.' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.estado).toBe('FALSE_POSITIVE');
    expect(resolved.body.caseId).toBeNull();
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({
      action: 'RESOLVE_AML_ALERT',
      resource: 'aml_alert',
      resourceId: oid('fp-alert'),
      detail: { dictamen: 'FALSE_POSITIVE', justificacion: 'Different date of birth.' },
    });
  });

  it('resolves CONFIRMED_MATCH to RESOLVED, writing an audit row', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('cm-alert')).transitionTo('INVESTIGATING', NOW));

    const resolved = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('cm-alert')}/resolve`)
      .send({ dictamen: 'CONFIRMED_MATCH', justificacion: 'Matched government ID.' });

    expect(resolved.status).toBe(200);
    expect(resolved.body.estado).toBe('RESOLVED');
    expect(auditRecorder.events).toHaveLength(1);
  });

  it('returns 400 for an unknown dictamen value', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('bogus-dictamen')).transitionTo('INVESTIGATING', NOW));

    const response = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('bogus-dictamen')}/resolve`)
      .send({ dictamen: 'BOGUS', justificacion: 'valid text' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('returns 400 for a missing/empty justificacion', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('empty-justificacion')).transitionTo('INVESTIGATING', NOW));

    const missing = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('empty-justificacion')}/resolve`)
      .send({ dictamen: 'CONFIRMED_MATCH' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('INVARIANT_VIOLATION');

    const empty = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('empty-justificacion')}/resolve`)
      .send({ dictamen: 'CONFIRMED_MATCH', justificacion: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('INVARIANT_VIOLATION');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('returns 422 when resolving an OPEN alert (must investigate first)', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('still-open')));

    const response = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('still-open')}/resolve`)
      .send({ dictamen: 'CONFIRMED_MATCH', justificacion: 'valid text' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('returns 422 when resolving an already-terminal alert, with no new audit row', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
    await amlAlertRepository.save(
      buildAlert(oid('terminal-alert')).transitionTo('INVESTIGATING', NOW).transitionTo('RESOLVED', NOW),
    );

    const response = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('terminal-alert')}/resolve`)
      .send({ dictamen: 'FALSE_POSITIVE', justificacion: 'valid text' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('returns 403 when resolving another tenant\'s alert', async () => {
    const { app, amlAlertRepository, auditRecorder } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('foreign-resolve'), ORG_2).transitionTo('INVESTIGATING', NOW));

    const response = await request(app)
      .patch(`/api/v1/aml-alerts/${oid('foreign-resolve')}/resolve`)
      .send({ dictamen: 'CONFIRMED_MATCH', justificacion: 'valid text' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('the old POST /aml-alerts/:id/resolve route no longer exists', async () => {
    const { app, amlAlertRepository } = buildApp();
    await amlAlertRepository.save(buildAlert(oid('old-route')).transitionTo('INVESTIGATING', NOW));

    const response = await request(app)
      .post(`/api/v1/aml-alerts/${oid('old-route')}/resolve`)
      .send({ outcome: 'RESOLVED' });

    expect([404, 405]).toContain(response.status);
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
