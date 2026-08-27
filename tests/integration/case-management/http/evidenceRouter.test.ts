import { oid } from '../../../support/oid.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { evidenceRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/evidenceRouter.js';
import { createRegisterEvidenceUseCase } from '../../../../src/modules/case-management/application/RegisterEvidence.js';
import { createCreateEvidenceDownloadUrlUseCase } from '../../../../src/modules/case-management/application/CreateEvidenceDownloadUrl.js';
import { createListEvidenceUseCase } from '../../../../src/modules/case-management/application/ListEvidence.js';
import { createGetEvidenceUseCase } from '../../../../src/modules/case-management/application/GetEvidence.js';
import { createDownloadEvidenceUseCase } from '../../../../src/modules/case-management/application/DownloadEvidence.js';
import { createDeleteEvidenceUseCase } from '../../../../src/modules/case-management/application/DeleteEvidence.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryEvidenceStore } from '../../../helpers/case-management/InMemoryEvidenceStore.js';
import { FakeMalwareScanner } from '../../../helpers/case-management/FakeMalwareScanner.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

async function buildApp() {
  const cases = new InMemoryCaseRepository();
  await cases.save(
    Case.create({
      id: createCaseId(oid('case-1')),
      organizationId: ORG_1,
      customerId: 'customer-1',
      riskScore: createRiskScore(50),
      priority: 'MEDIUM',
      // Assignment rule freezes orphan cases:
      // without an owner they cannot be worked.
      assignedTo: createAssignedTo('USER', oid('analyst-1')),
      now: NOW,
      // Instruction (notes/evidence) comes after review. See `WorkflowStepGate`.
    }).transitionTo('IN_REVIEW', NOW),
  );
  const investigations = new InMemoryInvestigationRepository();
  const evidence = new InMemoryEvidenceRepository();
  const evidenceStore = new InMemoryEvidenceStore();
  const router = evidenceRouter({
    createEvidenceDownloadUrl: createCreateEvidenceDownloadUrlUseCase({ evidence, evidenceStore, clock: new FixedClock(NOW) }),
    registerEvidence: createRegisterEvidenceUseCase({
      cases,
      investigations,
      evidence,
      evidenceStore,
      timestampAuthority: { requestTimestamp: async () => null },
      malwareScanner: new FakeMalwareScanner(),
      timelineRecorder: new InMemoryTimelineRecorder(),
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateEvidenceId,
      generateTimelineEventId,
    }),
    listEvidence: createListEvidenceUseCase({ cases, evidence }),
    getEvidence: createGetEvidenceUseCase({ evidence }),
    downloadEvidence: createDownloadEvidenceUseCase({ evidence, evidenceStore }),
    deleteEvidence: createDeleteEvidenceUseCase({
      evidence,
      timelineRecorder: new InMemoryTimelineRecorder(),
      auditRecorder: new InMemoryCaseManagementAuditRecorder(),
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
      generateTimelineEventId,
    }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, ANALYST);
    next();
  }
  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(router);

  return createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(caseManagementErrorStatus),
  });
}

describe('evidenceRouter (e2e, multipart upload + download)', () => {
  it('uploads a file (multipart), then lists, gets and downloads it', async () => {
    const app = await buildApp();
    const bytes = Buffer.from('a fraudulent invoice PDF');

    const upload = await request(app)
      .post(`/api/v1/cases/${oid('case-1')}/evidence`)
      .attach('file', bytes, { filename: 'invoice.pdf', contentType: 'application/pdf' });

    expect(upload.status).toBe(201);
    expect(upload.body.filename).toBe('invoice.pdf');
    expect(upload.body.sha256).toHaveLength(64);
    expect(upload.body.storageKey).toBeUndefined();
    const evidenceId = upload.body.id;

    const list = await request(app).get(`/api/v1/cases/${oid('case-1')}/evidence`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);

    const meta = await request(app).get(`/api/v1/evidence/${evidenceId}`);
    expect(meta.status).toBe(200);
    expect(meta.body.byteSize).toBe(bytes.length);

    const download = await request(app).get(`/api/v1/evidence/${evidenceId}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body)).toEqual(bytes);
  });

  it('returns 400 when no file field is present', async () => {
    const app = await buildApp();
    const response = await request(app).post(`/api/v1/cases/${oid('case-1')}/evidence`);
    expect(response.status).toBe(400);
  });
});
