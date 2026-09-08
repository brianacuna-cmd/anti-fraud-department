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
import { createGenerateSarReportXmlUseCase } from '../../../../src/modules/sar/application/GenerateSarReportXml.js';
import { createRecordSarFilingStatusUseCase } from '../../../../src/modules/sar/application/RecordSarFilingStatus.js';
import { createGetSarFilingProfileUseCase } from '../../../../src/modules/sar/application/GetSarFilingProfile.js';
import { createUpsertSarFilingProfileUseCase } from '../../../../src/modules/sar/application/UpsertSarFilingProfile.js';
import { generateOrganizationSarFilingProfileId } from '../../../../src/modules/sar/domain/model/value-objects/OrganizationSarFilingProfileId.js';
import { InMemorySarFilingProfileRepository } from '../../../helpers/sar/InMemorySarFilingProfileRepository.js';

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

  const profiles = new InMemorySarFilingProfileRepository();
  const generateSarReportXml = createGenerateSarReportXmlUseCase({
    reports,
    profiles,
    auditRecorder,
    clock,
  });
  const recordSarFilingStatus = createRecordSarFilingStatusUseCase({
    reports,
    auditRecorder,
    unitOfWork,
    clock,
  });
  const getSarFilingProfile = createGetSarFilingProfileUseCase({ profiles });
  const upsertSarFilingProfile = createUpsertSarFilingProfileUseCase({
    profiles,
    auditRecorder,
    unitOfWork,
    clock,
    generateOrganizationSarFilingProfileId,
  });

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(
    sarReportRouter({
      createSarReportDraft,
      approveSarReportDraft,
      generateSarReportXml,
      recordSarFilingStatus,
      getSarFilingProfile,
      upsertSarFilingProfile,
    }),
  );

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ ...sarErrorStatus }),
    }),
    reports,
    auditRecorder,
    sourceVerifier,
    profiles,
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

/** El perfil de presentación completo, tal y como lo manda el panel. */
const FILING_PROFILE_BODY = {
  filerName: 'Finturu Inc.',
  filerTin: '123456789',
  filerTinType: 'EIN',
  filerAddress: {
    street: '1 Market St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'US',
  },
  contactName: 'Compliance Office',
  contactPhone: '+15550100',
  contactEmail: 'compliance@example.com',
};

/** Un borrador con todo lo que el esquema de presentación exige. */
const FILEABLE_DRAFT = {
  caseId: oid('case-1'),
  narrative: 'Structured deposits below the reporting threshold.',
  subjectName: 'Jane Doe',
  subjectAddress: {
    street: '99 Mission St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94103',
    country: 'US',
  },
  suspiciousAmount: 42000,
  activityStartDate: '2025-11-01T00:00:00.000Z',
  activityEndDate: '2025-11-06T00:00:00.000Z',
  activityCategories: ['STRUCTURING'],
};

describe('PUT/GET /sar-filing-profile', () => {
  it('returns null before it is ever configured', async () => {
    const { app } = buildApp(SUPERVISOR);
    const response = await request(app).get('/api/v1/sar-filing-profile').expect(200);
    expect(response.body).toBeNull();
  });

  it('stores the filing identity and reads it back', async () => {
    const { app, profiles, auditRecorder } = buildApp(SUPERVISOR);

    await request(app).put('/api/v1/sar-filing-profile').send(FILING_PROFILE_BODY).expect(200);

    const response = await request(app).get('/api/v1/sar-filing-profile').expect(200);
    expect(response.body.filerName).toBe('Finturu Inc.');
    expect(response.body.filerAddress.state).toBe('CA');
    expect(profiles.all()).toHaveLength(1);
    expect(auditRecorder.all().map((e) => e.action)).toContain('UPSERT_SAR_FILING_PROFILE');
  });

  /* Se reemplaza entero: dos PUT dejan UN perfil, no dos. */
  it('replaces the profile instead of adding a second one', async () => {
    const { app, profiles } = buildApp(SUPERVISOR);

    await request(app).put('/api/v1/sar-filing-profile').send(FILING_PROFILE_BODY).expect(200);
    await request(app)
      .put('/api/v1/sar-filing-profile')
      .send({ ...FILING_PROFILE_BODY, filerName: 'Finturu LLC' })
      .expect(200);

    expect(profiles.all()).toHaveLength(1);
    expect(profiles.all()[0]?.filerName).toBe('Finturu LLC');
  });

  /* Un EIN son nueve dígitos: se rechaza al guardar, no al presentar. */
  it('rejects a malformed EIN', async () => {
    const { app } = buildApp(SUPERVISOR);
    await request(app)
      .put('/api/v1/sar-filing-profile')
      .send({ ...FILING_PROFILE_BODY, filerTin: '12' })
      .expect(400);
  });

  it('rejects ANALYST with 403', async () => {
    const { app } = buildApp(ANALYST);
    await request(app).put('/api/v1/sar-filing-profile').send(FILING_PROFILE_BODY).expect(403);
  });
});

describe('GET /sar-reports/:id/xml', () => {
  /** Deja un informe aprobado y listo para presentar. */
  async function approvedReport(app: import('express').Express): Promise<string> {
    const created = await request(app).post('/api/v1/sar-reports').send(FILEABLE_DRAFT).expect(201);
    return created.body.id;
  }

  it('renders the filing document for an approved report', async () => {
    /* Cuatro ojos: quien redacta no aprueba, asi que el actor cambia. */
    let currentActor = SUPERVISOR;
    const { app, sourceVerifier, auditRecorder } = buildApp(() => currentActor());
    sourceVerifier.allowCase(FILEABLE_DRAFT.caseId, true);
    await request(app).put('/api/v1/sar-filing-profile').send(FILING_PROFILE_BODY).expect(200);
    const id = await approvedReport(app);

    currentActor = SUPERVISOR_2;
    await request(app).patch(`/api/v1/sar-reports/${id}/approve`).send({}).expect(200);

    const response = await request(app).get(`/api/v1/sar-reports/${id}/xml`).expect(200);

    expect(response.headers['content-type']).toContain('application/xml');
    expect(response.headers['content-disposition']).toContain(`sar-${id}.xml`);
    expect(response.text).toContain('<EFilingBatchXML');
    expect(response.text).toContain('Finturu Inc.');
    expect(auditRecorder.all().map((e) => e.action)).toContain('GENERATE_SAR_REPORT_FILE');
  });

  /*
   * 422 con TODOS los defectos: quien completa el informe necesita verlos de
   * una vez, no uno por intento.
   */
  it('refuses with the full defect list when the tenant has no filing profile', async () => {
    let currentActor = SUPERVISOR;
    const { app, sourceVerifier } = buildApp(() => currentActor());
    sourceVerifier.allowCase(FILEABLE_DRAFT.caseId, true);
    const id = await approvedReport(app);
    currentActor = SUPERVISOR_2;
    await request(app).patch(`/api/v1/sar-reports/${id}/approve`).send({}).expect(200);

    const response = await request(app).get(`/api/v1/sar-reports/${id}/xml`).expect(422);

    expect(response.body.error.code).toBe('SAR_NOT_READY_TO_FILE');
    expect(response.body.error.metadata.defects.map((d: { field: string }) => d.field)).toContain('filer');
  });

  it('refuses to build a file from a draft that was never approved', async () => {
    const { app, sourceVerifier } = buildApp(SUPERVISOR);
    sourceVerifier.allowCase(FILEABLE_DRAFT.caseId, true);
    await request(app).put('/api/v1/sar-filing-profile').send(FILING_PROFILE_BODY).expect(200);
    const id = await approvedReport(app);

    const response = await request(app).get(`/api/v1/sar-reports/${id}/xml`).expect(422);
    expect(
      response.body.error.metadata.defects.map((d: { field: string }) => d.field),
    ).toContain('report.status');
  });

  it('returns 404 for a report from another organization', async () => {
    const { app } = buildApp(() =>
      createAuthContext({
        userId: oid('sup-1'),
        organizationId: oid('org-2'),
        actorType: 'USER',
        roleId: 'SUPERVISOR',
      }),
    );
    await request(app).get(`/api/v1/sar-reports/${oid('missing')}/xml`).expect(404);
  });
});

describe('PATCH /sar-reports/:id/filing-status', () => {
  const BSA_ID = '31000012345678';

  /** Deja un informe aprobado (cuatro ojos: redacta uno, aprueba otro). */
  async function approvedReport(): Promise<{
    app: import('express').Express;
    id: string;
    auditRecorder: ReturnType<typeof buildApp>['auditRecorder'];
  }> {
    let currentActor = SUPERVISOR;
    const { app, sourceVerifier, auditRecorder } = buildApp(() => currentActor());
    sourceVerifier.allowCase(oid('case-1'), true);
    const created = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'Structured deposits.' })
      .expect(201);
    currentActor = SUPERVISOR_2;
    await request(app).patch(`/api/v1/sar-reports/${created.body.id}/approve`).send({}).expect(200);
    return { app, id: created.body.id, auditRecorder };
  }

  it('records the tracking number and the acknowledgement', async () => {
    const { app, id, auditRecorder } = await approvedReport();

    const response = await request(app)
      .patch(`/api/v1/sar-reports/${id}/filing-status`)
      .send({
        outcome: 'FILED',
        bsaIdentifier: BSA_ID,
        filedAt: '2025-12-01T00:00:00.000Z',
        acknowledgementReference: 'ACK-2026-0042',
      })
      .expect(200);

    expect(response.body.status).toBe('FILED');
    expect(response.body.bsaIdentifier).toBe(BSA_ID);
    expect(response.body.acknowledgementReference).toBe('ACK-2026-0042');
    expect(auditRecorder.all().map((e) => e.action)).toContain('RECORD_SAR_FILING_STATUS');
  });

  it('records a rejection with its reason', async () => {
    const { app, id } = await approvedReport();

    const response = await request(app)
      .patch(`/api/v1/sar-reports/${id}/filing-status`)
      .send({ outcome: 'REJECTED', reason: 'Subject TIN failed validation' })
      .expect(200);

    expect(response.body.status).toBe('FILING_REJECTED');
    expect(response.body.filingRejectionReason).toBe('Subject TIN failed validation');
  });

  /*
   * Union discriminada: una aceptacion sin numero de radicacion y un rechazo
   * sin motivo no significan nada, asi que mezclarlos es 400.
   */
  it('rejects a body that mixes the two outcomes', async () => {
    const { app, id } = await approvedReport();

    await request(app)
      .patch(`/api/v1/sar-reports/${id}/filing-status`)
      .send({ outcome: 'FILED', reason: 'no tracking number here' })
      .expect(400);
  });

  it('rejects a malformed BSA identifier', async () => {
    const { app, id } = await approvedReport();

    await request(app)
      .patch(`/api/v1/sar-reports/${id}/filing-status`)
      .send({ outcome: 'FILED', bsaIdentifier: '123', filedAt: '2025-12-01T00:00:00.000Z' })
      .expect(400);
  });

  it('refuses to file a draft that was never approved', async () => {
    const { app, sourceVerifier } = buildApp(SUPERVISOR);
    sourceVerifier.allowCase(oid('case-1'), true);
    const created = await request(app)
      .post('/api/v1/sar-reports')
      .send({ caseId: oid('case-1'), narrative: 'x' })
      .expect(201);

    await request(app)
      .patch(`/api/v1/sar-reports/${created.body.id}/filing-status`)
      .send({ outcome: 'FILED', bsaIdentifier: BSA_ID, filedAt: '2025-12-01T00:00:00.000Z' })
      .expect(422);
  });

  it('rejects ANALYST with 403', async () => {
    const { app } = buildApp(ANALYST);
    await request(app)
      .patch(`/api/v1/sar-reports/${oid('any')}/filing-status`)
      .send({ outcome: 'REJECTED', reason: 'x' })
      .expect(403);
  });
});
