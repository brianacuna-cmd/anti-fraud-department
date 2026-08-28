import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { sarErrorStatus } from '../../../../src/modules/sar/infrastructure/adapters/inbound/http/errorStatus.js';
import { sarReportRouter } from '../../../../src/modules/sar/infrastructure/adapters/inbound/http/sarReportRouter.js';
import { createCreateSarReportDraftUseCase } from '../../../../src/modules/sar/application/CreateSarReportDraft.js';
import { createApproveSarReportDraftUseCase } from '../../../../src/modules/sar/application/ApproveSarReportDraft.js';
import { generateSarReportId } from '../../../../src/modules/sar/domain/model/value-objects/SarReportId.js';
import { InMemorySarReportRepository } from '../../../helpers/sar/InMemorySarReportRepository.js';
import { InMemorySarAuditRecorder } from '../../../helpers/sar/InMemorySarAuditRecorder.js';
import { FakeSarSourceVerifier } from '../../../helpers/sar/FakeSarSourceVerifier.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/sar/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');

function buildApp(actorPerRequest: () => AuthContext) {
  const reports = new InMemorySarReportRepository();
  const auditRecorder = new InMemorySarAuditRecorder();
  const sourceVerifier = new FakeSarSourceVerifier();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);

  const createSarReportDraft = createCreateSarReportDraftUseCase({
    reports,
    sourceVerifier,
    auditRecorder,
    unitOfWork,
    clock,
    generateSarReportId,
  });
  const approveSarReportDraft = createApproveSarReportDraftUseCase({
    reports,
    auditRecorder,
    unitOfWork,
    clock,
  });

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(sarReportRouter({ createSarReportDraft, approveSarReportDraft }));

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ ...sarErrorStatus }),
    }),
    reports,
    auditRecorder,
    sourceVerifier,
  };
}

const SUPERVISOR = () =>
  createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const SUPERVISOR_2 = () =>
  createAuthContext({ userId: oid('sup-2'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = () =>
  createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

describe('sarReportRouter (HTTP)', () => {
  it('POST /sar-reports crea un borrador DRAFT contra un caso elegible (201)', async () => {
    const { app, reports, sourceVerifier } = buildApp(SUPERVISOR);
    sourceVerifier.allowCase(oid('case-1'), true);

    const res = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'Volumen atípico de transferencias.' })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.caseId).toBe(oid('case-1'));
    expect(res.body.amlAlertId).toBeNull();
    expect(reports.all()).toHaveLength(1);
  });

  it('POST /sar-reports crea un borrador contra una alerta AML elegible (201)', async () => {
    const { app, sourceVerifier } = buildApp(SUPERVISOR);
    sourceVerifier.allowAmlAlert(oid('alert-1'), true);

    const res = await request(app)
      .post('/api/v1/sar-reports')
      .send({ amlAlertId: oid('alert-1'), narrative: 'Coincidencia confirmada.' })
      .expect(201);

    expect(res.body.amlAlertId).toBe(oid('alert-1'));
  });

  it('rechaza a un ANALYST con 403', async () => {
    const { app, sourceVerifier } = buildApp(ANALYST);
    sourceVerifier.allowCase(oid('case-1'), true);

    const res = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('rechaza payload inválido (ni caseId ni amlAlertId) con 400', async () => {
    const { app } = buildApp(SUPERVISOR);

    const res = await request(app)
      .post('/api/v1/sar-reports')
      .send({ narrative: 'x' })
      .expect(400);

    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('devuelve 404 cuando el caso no existe', async () => {
    const { app } = buildApp(SUPERVISOR);

    const res = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('missing'), narrative: 'x' })
      .expect(404);

    expect(res.body.error.code).toBe('SAR_SOURCE_NOT_FOUND');
  });

  it('devuelve 409 cuando el caso existe pero no está confirmado', async () => {
    const { app, sourceVerifier } = buildApp(SUPERVISOR);
    sourceVerifier.allowCase(oid('case-1'), false);

    const res = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(409);

    expect(res.body.error.code).toBe('SAR_SOURCE_NOT_ELIGIBLE');
  });
});

describe('sarReportRouter (HTTP) — PATCH /sar-reports/:id/approve', () => {
  it('aprueba y bloquea un borrador cuando lo revisa una persona distinta a quien lo redactó (200)', async () => {
    let currentActor = SUPERVISOR;
    const { app, sourceVerifier } = buildApp(() => currentActor());
    sourceVerifier.allowCase(oid('case-1'), true);

    const created = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(201);

    currentActor = SUPERVISOR_2;
    const res = await request(app)
      .patch(`/api/v1/sar-reports/${created.body.id}/approve`)
      .send({})
      .expect(200);

    expect(res.body.status).toBe('APPROVED');
    expect(res.body.approvedBy).toBe(oid('sup-2'));
    expect(res.body.approvedAt).not.toBeNull();
  });

  it('rechaza que quien redactó el borrador lo apruebe (cuatro ojos, 403)', async () => {
    const { app, sourceVerifier } = buildApp(SUPERVISOR);
    sourceVerifier.allowCase(oid('case-1'), true);

    const created = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(201);

    const res = await request(app)
      .patch(`/api/v1/sar-reports/${created.body.id}/approve`)
      .send({})
      .expect(403);

    expect(res.body.error.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('rechaza a un ANALYST con 403', async () => {
    let currentActor = SUPERVISOR;
    const { app, sourceVerifier } = buildApp(() => currentActor());
    sourceVerifier.allowCase(oid('case-1'), true);

    const created = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(201);

    currentActor = ANALYST;
    const res = await request(app)
      .patch(`/api/v1/sar-reports/${created.body.id}/approve`)
      .send({})
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('devuelve 404 cuando el reporte no existe', async () => {
    const { app } = buildApp(SUPERVISOR);

    const res = await request(app)
      .patch(`/api/v1/sar-reports/${oid('missing')}/approve`)
      .send({})
      .expect(404);

    expect(res.body.error.code).toBe('SAR_REPORT_NOT_FOUND');
  });

  it('devuelve 422 al intentar aprobar un reporte ya APROBADO', async () => {
    let currentActor = SUPERVISOR;
    const { app, sourceVerifier } = buildApp(() => currentActor());
    sourceVerifier.allowCase(oid('case-1'), true);

    const created = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(201);

    currentActor = SUPERVISOR_2;
    await request(app).patch(`/api/v1/sar-reports/${created.body.id}/approve`).send({}).expect(200);

    const res = await request(app)
      .patch(`/api/v1/sar-reports/${created.body.id}/approve`)
      .send({})
      .expect(422);

    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});
