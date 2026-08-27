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
import { evidenceRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/evidenceRouter.js';
import { noteRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/noteRouter.js';
import { createRegisterEvidenceUseCase } from '../../../../src/modules/case-management/application/RegisterEvidence.js';
import { createCreateEvidenceDownloadUrlUseCase } from '../../../../src/modules/case-management/application/CreateEvidenceDownloadUrl.js';
import { createListEvidenceUseCase } from '../../../../src/modules/case-management/application/ListEvidence.js';
import { createGetEvidenceUseCase } from '../../../../src/modules/case-management/application/GetEvidence.js';
import { createDownloadEvidenceUseCase } from '../../../../src/modules/case-management/application/DownloadEvidence.js';
import { createDeleteEvidenceUseCase } from '../../../../src/modules/case-management/application/DeleteEvidence.js';
import { createDeleteCaseNoteUseCase } from '../../../../src/modules/case-management/application/DeleteCaseNote.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryEvidenceRepository } from '../../../helpers/case-management/InMemoryEvidenceRepository.js';
import { InMemoryEvidenceStore } from '../../../helpers/case-management/InMemoryEvidenceStore.js';
import { FakeMalwareScanner } from '../../../helpers/case-management/FakeMalwareScanner.js';
import { InMemoryCaseNoteRepository } from '../../../helpers/case-management/InMemoryCaseNoteRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { Evidence } from '../../../../src/modules/case-management/domain/model/aggregates/Evidence.js';
import { CaseNote } from '../../../../src/modules/case-management/domain/model/aggregates/CaseNote.js';
import { createEvidenceId } from '../../../../src/modules/case-management/domain/model/value-objects/EvidenceId.js';
import { createCaseNoteId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseNoteId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const CASE_ID = oid('case-1');
const EV_ID = oid('ev-1');
const NOTE_ID = oid('note-1');

const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });
const ADMIN = createAuthContext({ userId: oid('adm-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ADMIN' });
/** The ORGANIZATION actor never carries `roleId`: the session resolver only resolves it for USER. */
const ORGANIZATION = createAuthContext({ userId: ORG_1, organizationId: ORG_1, actorType: 'ORGANIZATION' });

function seedEvidence(): Evidence {
  return Evidence.register({
    id: createEvidenceId(EV_ID),
    caseId: createCaseId(CASE_ID),
    investigationId: null,
    organizationId: ORG_1,
    filename: 'proof.pdf',
    contentType: 'application/pdf',
    byteSize: 1024,
    sha256: 'a'.repeat(64),
    storageKey: 'k/1',
    timestamp: null,
    scanStatus: 'CLEAN',
    uploadedBy: oid('an-1'),
    now: NOW,
  });
}

function seedNote(): CaseNote {
  return CaseNote.create({
    id: createCaseNoteId(NOTE_ID),
    caseId: createCaseId(CASE_ID),
    organizationId: ORG_1,
    authorId: oid('an-1'),
    body: 'wrong note',
    now: NOW,
  });
}

function buildApp(actorPerRequest: () => AuthContext = () => SUPERVISOR) {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const evidence = new InMemoryEvidenceRepository();
  const evidenceStore = new InMemoryEvidenceStore();
  const notes = new InMemoryCaseNoteRepository();
  const shared = {
    timelineRecorder: new InMemoryTimelineRecorder(),
    auditRecorder: new InMemoryCaseManagementAuditRecorder(),
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateTimelineEventId,
  };

  const evidenceHttp = evidenceRouter({
    createEvidenceDownloadUrl: createCreateEvidenceDownloadUrlUseCase({ evidence, evidenceStore, clock: new FixedClock(NOW) }),
    registerEvidence: createRegisterEvidenceUseCase({
      cases,
      investigations,
      evidence,
      evidenceStore,
      timestampAuthority: { requestTimestamp: async () => null },
      malwareScanner: new FakeMalwareScanner(),
      ...shared,
      generateEvidenceId,
    }),
    listEvidence: createListEvidenceUseCase({ cases, evidence }),
    getEvidence: createGetEvidenceUseCase({ evidence }),
    downloadEvidence: createDownloadEvidenceUseCase({ evidence, evidenceStore }),
    deleteEvidence: createDeleteEvidenceUseCase({ evidence, ...shared }),
  });
  const noteHttp = noteRouter({
    deleteCaseNote: createDeleteCaseNoteUseCase({ notes, ...shared }),
  });

  function testAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
    attachAuthContext(req, actorPerRequest());
    next();
  }
  const mounted = Router();
  mounted.use(testAuthMiddleware);
  mounted.use(evidenceHttp);
  mounted.use(noteHttp);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler(caseManagementErrorStatus),
  });
  return { app, evidence, notes };
}

describe('DELETE /evidence/:id and /notes/:id (soft delete)', () => {
  it('soft-deletes evidence for SUPERVISOR and hides it from GET', async () => {
    const { app, evidence } = buildApp();
    await evidence.save(seedEvidence());

    const del = await request(app).delete(`/api/v1/evidence/${EV_ID}`);
    expect(del.status).toBe(200);
    expect(del.body.deletedAt).not.toBeNull();

    const get = await request(app).get(`/api/v1/evidence/${EV_ID}`);
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('EVIDENCE_NOT_FOUND');
  });

  it('rejects evidence delete for ANALYST with 403', async () => {
    const { app, evidence } = buildApp(() => ANALYST);
    await evidence.save(seedEvidence());

    const del = await request(app).delete(`/api/v1/evidence/${EV_ID}`);
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('soft-deletes a note for SUPERVISOR', async () => {
    const { app, notes } = buildApp();
    await notes.save(seedNote());

    const del = await request(app).delete(`/api/v1/notes/${NOTE_ID}`);
    expect(del.status).toBe(200);
    expect(del.body.deletedAt).not.toBeNull();
    expect(await notes.listByCaseId(createCaseId(CASE_ID))).toHaveLength(0);
  });

  /**
   * The regression that motivated the policy: with an organization session,
   * the case answered `role "null" is not authorized` on every button. Now
   * it is still a 403 — that session does not operate — but the body says
   * WHY, and the UI uses that `readOnly` to not even offer the button.
   */
  it.each([
    ['ADMIN', () => ADMIN],
    ['the ORGANIZATION actor', () => ORGANIZATION],
  ])('answers %s with an explicit read-only 403, never a null-role one', async (_label, actor) => {
    const { app, evidence, notes } = buildApp(actor);
    await evidence.save(seedEvidence());
    await notes.save(seedNote());

    for (const path of [`/api/v1/evidence/${EV_ID}`, `/api/v1/notes/${NOTE_ID}`]) {
      const del = await request(app).delete(path);
      expect(del.status).toBe(403);
      expect(del.body.error.code).toBe('FORBIDDEN_ROLE');
      expect(del.body.error.metadata.readOnly).toBe(true);
      expect(del.body.error.message).not.toContain('null');
    }

    // And nothing was touched.
    expect(await notes.listByCaseId(createCaseId(CASE_ID))).toHaveLength(1);
  });

  /** Reads yes: the governance plane observes the whole case. */
  it('still lets the ORGANIZATION actor read the evidence it may not delete', async () => {
    const { app, evidence } = buildApp(() => ORGANIZATION);
    await evidence.save(seedEvidence());

    const get = await request(app).get(`/api/v1/evidence/${EV_ID}`);
    expect(get.status).toBe(200);
    expect(get.body.filename).toBe('proof.pdf');
  });

  it('returns 404 for a missing note', async () => {
    const { app } = buildApp();
    const del = await request(app).delete(`/api/v1/notes/${oid('missing')}`);
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe('CASE_NOTE_NOT_FOUND');
  });
});
