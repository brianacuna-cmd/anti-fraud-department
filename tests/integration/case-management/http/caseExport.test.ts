import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { caseExportRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/caseExportRouter.js';
import { createExportCasesUseCase } from '../../../../src/modules/case-management/application/ExportCases.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const AUDITOR = createAuthContext({ userId: oid('aud-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'AUDITOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

let seq = 0;
function seedCase(cases: InMemoryCaseRepository): void {
  seq += 1;
  void cases.save(
    Case.create({
      id: createCaseId(oid(`case-exp-${seq}`)),
      organizationId: ORG_1,
      customerId: `customer-${seq}`,
      riskScore: createRiskScore(50),
      priority: 'MEDIUM',
      tags: ['fraud'],
      now: NOW,
    }),
  );
}

function buildApp(actorPerRequest: () => AuthContext = () => AUDITOR, withShadowRoute = false) {
  const cases = new InMemoryCaseRepository();
  seedCase(cases);
  seedCase(cases);

  const exportHttp = caseExportRouter({ exportCases: createExportCasesUseCase({ cases }) });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }
  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(exportHttp);
  // Mimic main.ts ordering: export router mounted BEFORE the /cases/:caseId route.
  if (withShadowRoute) {
    const shadow = Router();
    shadow.get('/cases/:caseId', (req, res) => res.status(200).json({ shadowedCaseId: req.params.caseId }));
    mounted.use(shadow);
  }

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(caseManagementErrorStatus),
  });
  return { app, cases };
}

describe('caseExportRouter GET /cases/export', () => {
  it('exports JSON by default with attachment headers', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/cases/export').expect(200);

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment; filename="cases-export-');
    expect(res.headers['x-total-count']).toBe('2');
    const parsed = JSON.parse(res.text);
    expect(parsed.total).toBe(2);
  });

  it('exports XLSX (spreadsheet content-type, PK magic bytes)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/cases/export?format=xlsx').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('exports PDF (%PDF header)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/cases/export?format=pdf').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('is not shadowed by GET /cases/:caseId when mounted first', async () => {
    const { app } = buildApp(() => AUDITOR, true);
    const res = await request(app).get('/api/v1/cases/export').expect(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.shadowedCaseId).toBeUndefined();
  });

  it('returns 400 for an invalid format', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/cases/export?format=csv').expect(400);
    expect(res.body.error.code).toBe('INVARIANT_VIOLATION');
  });

  it('returns 403 for ANALYST', async () => {
    const { app } = buildApp(() => ANALYST);
    const res = await request(app).get('/api/v1/cases/export').expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
  });
});
