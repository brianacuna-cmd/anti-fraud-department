import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { oid } from '../../../support/oid.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { regulatoryErrorStatus } from '../../../../src/modules/regulatory/infrastructure/adapters/inbound/http/errorStatus.js';
import { regulatoryReportRouter } from '../../../../src/modules/regulatory/infrastructure/adapters/inbound/http/regulatoryReportRouter.js';
import { createCompileRegulatoryReportUseCase } from '../../../../src/modules/regulatory/application/CompileRegulatoryReport.js';
import { createIssueRegulatoryReportUseCase } from '../../../../src/modules/regulatory/application/IssueRegulatoryReport.js';
import { createExportRegulatoryReportUseCase } from '../../../../src/modules/regulatory/application/ExportRegulatoryReport.js';
import { createGetRegulatoryReportUseCase } from '../../../../src/modules/regulatory/application/GetRegulatoryReport.js';
import { createListRegulatoryReportsUseCase } from '../../../../src/modules/regulatory/application/ListRegulatoryReports.js';
import { generateRegulatoryReportId } from '../../../../src/modules/regulatory/domain/model/value-objects/RegulatoryReportId.js';
import { PdfRegulatoryReportRenderer } from '../../../../src/modules/regulatory/infrastructure/adapters/outbound/render/PdfRegulatoryReportRenderer.js';
import { XlsxRegulatoryReportRenderer } from '../../../../src/modules/regulatory/infrastructure/adapters/outbound/render/XlsxRegulatoryReportRenderer.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/regulatory/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryRegulatoryReportRepository } from '../../../helpers/regulatory/InMemoryRegulatoryReportRepository.js';
import { InMemoryRegulatoryAuditRecorder } from '../../../helpers/regulatory/InMemoryRegulatoryAuditRecorder.js';
import { FakeRegulatoryFigureSource } from '../../../helpers/regulatory/FakeRegulatoryFigureSource.js';
import { FixedClock } from '../../../helpers/FixedClock.js';

const NOW = fromDate(new Date('2026-10-05T00:00:00.000Z'));
const ORG = oid('org-1');

function supervisor(): AuthContext {
  return createAuthContext({
    userId: oid('sup-1'),
    organizationId: ORG,
    actorType: 'USER',
    roleId: 'SUPERVISOR',
  });
}

function analyst(): AuthContext {
  return createAuthContext({
    userId: oid('an-1'),
    organizationId: ORG,
    actorType: 'USER',
    roleId: 'ANALYST',
  });
}

function buildApp(actorPerRequest: () => AuthContext) {
  const reports = new InMemoryRegulatoryReportRepository();
  const figures = new FakeRegulatoryFigureSource();
  figures.returns({ casesOpened: 12, sarsFiled: 2, suspiciousAmountDeclared: 1500 });
  const auditRecorder = new InMemoryRegulatoryAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);

  const api = Router();
  api.use((req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, actorPerRequest());
    next();
  });
  api.use(
    regulatoryReportRouter({
      compileRegulatoryReport: createCompileRegulatoryReportUseCase({
        reports,
        figures,
        auditRecorder,
        unitOfWork,
        clock,
        generateRegulatoryReportId,
      }),
      issueRegulatoryReport: createIssueRegulatoryReportUseCase({
        reports,
        auditRecorder,
        unitOfWork,
        clock,
      }),
      exportRegulatoryReport: createExportRegulatoryReportUseCase({
        reports,
        renderers: [new PdfRegulatoryReportRenderer(), new XlsxRegulatoryReportRenderer()],
        auditRecorder,
      }),
      getRegulatoryReport: createGetRegulatoryReportUseCase({ reports }),
      listRegulatoryReports: createListRegulatoryReportsUseCase({ reports }),
    }),
  );

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: api }],
      errorHandler: createErrorHandler({ UNAUTHENTICATED: 401, ...regulatoryErrorStatus }),
    }),
    reports,
  };
}

describe('regulatoryReportRouter', () => {
  it('POST /regulatory-reports compiles a draft for SUPERVISOR', async () => {
    const { app } = buildApp(supervisor);

    const res = await request(app)
      .post('/api/v1/regulatory-reports')
      .send({
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-30T23:59:59.000Z',
      })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.figures.casesOpened).toBe(12);
    expect(res.body.figures.sarsFiled).toBe(2);
    expect(res.body.figures.blockedAmount).toBeNull();
  });

  it('GET export returns a PDF package', async () => {
    const { app } = buildApp(supervisor);
    const created = await request(app)
      .post('/api/v1/regulatory-reports')
      .send({
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-30T23:59:59.000Z',
      })
      .expect(201);

    const exported = await request(app)
      .get(`/api/v1/regulatory-reports/${created.body.id}/export?format=pdf`)
      .expect(200);

    expect(exported.headers['content-type']).toMatch(/application\/pdf/);
    expect(exported.body.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('rejects ANALYST compile with 403', async () => {
    const { app } = buildApp(analyst);

    await request(app)
      .post('/api/v1/regulatory-reports')
      .send({
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-30T23:59:59.000Z',
      })
      .expect(403);
  });
});
