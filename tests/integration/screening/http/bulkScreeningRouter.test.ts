import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Router, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { oid } from '../../../support/oid.js';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { screeningErrorStatus } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/errorStatus.js';
import { bulkScreeningRouter } from '../../../../src/modules/screening/infrastructure/adapters/inbound/http/bulkScreeningRouter.js';
import { generateBulkScreeningJobId } from '../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import { InMemoryBulkScreeningJobRepository } from '../../../helpers/screening/InMemoryBulkScreeningJobRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createSubmitBulkScreeningJobUseCase } from '../../../../src/modules/screening/application/SubmitBulkScreeningJob.js';
import { createGetBulkScreeningJobUseCase } from '../../../../src/modules/screening/application/GetBulkScreeningJob.js';
import { createRunBulkScreeningJobUseCase } from '../../../../src/modules/screening/application/RunBulkScreeningJob.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import type { BulkCsvSource, CsvRow } from '../../../../src/modules/screening/domain/ports/BulkCsvSource.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ORG_1_ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

/** Fake BulkCsvSource — never touches disk, yields no rows. */
class FakeBulkCsvSource implements BulkCsvSource {
  async *readRows(_filePath: string): AsyncIterable<CsvRow> {
    // no rows
  }
  async discard(_filePath: string): Promise<void> {
    // no-op
  }
}

const TEMP_DIR = path.join(os.tmpdir(), 'bulk-screening-test');

function buildApp(actorPerRequest: (() => AuthContext) | null = () => ORG_1_ANALYST) {
  const jobRepo = new InMemoryBulkScreeningJobRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const unitOfWork = new PassthroughUnitOfWork();
  const clock = new FixedClock(NOW);
  const csvSource = new FakeBulkCsvSource();

  const runBulkScreeningJob = createRunBulkScreeningJobUseCase({
    bulkScreeningJobRepository: jobRepo,
    bulkCsvSource: csvSource,
    screenSubject: async () => ({ matches: [], riskSignal: null }),
    auditRecorder,
    clock,
  });

  const submitBulkScreeningJob = createSubmitBulkScreeningJobUseCase({
    bulkScreeningJobRepository: jobRepo,
    auditRecorder,
    unitOfWork,
    clock,
    generateJobId: generateBulkScreeningJobId,
    createRunJob: (auth, jobId) => () => runBulkScreeningJob({ auth, jobId }),
    scheduleWork: () => {},
  });

  const getBulkScreeningJob = createGetBulkScreeningJobUseCase({
    bulkScreeningJobRepository: jobRepo,
  });

  const router = bulkScreeningRouter({
    submitBulkScreeningJob,
    getBulkScreeningJob,
    tempDir: TEMP_DIR,
  });

  const mounted = Router();
  if (actorPerRequest !== null) {
    mounted.use((req: Request, _res: Response, next: NextFunction) => {
      attachAuthContext(req, actorPerRequest());
      next();
    });
  }
  mounted.use(router);

  const app = createApp({
    routers: [{ path: '/api/v1', router: mounted }],
    errorHandler: createErrorHandler({
      ...screeningErrorStatus,
      UNAUTHENTICATED: 401,
    }),
  });

  return { app, jobRepo, auditRecorder };
}

/** Write a minimal CSV to a temp file for upload tests. */
function writeCsvFile(content: string): string {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const p = path.join(TEMP_DIR, `test-${Date.now()}.csv`);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('POST /api/v1/bulk-screening-jobs', () => {
  it('returns 202 with job id when a valid CSV is uploaded', async () => {
    const { app } = buildApp();
    const csvPath = writeCsvFile('customer_id,name\nabc123,Alice\n');

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'text/csv' });

    expect(response.status).toBe(202);
    expect(typeof response.body.id).toBe('string');
    expect(response.body.id).toHaveLength(24);
    expect(JSON.stringify(response.body)).not.toContain('filePath');
    expect(JSON.stringify(response.body)).not.toContain('file_path');
  });

  it('returns 400 when no file is attached', async () => {
    const { app } = buildApp();

    const response = await request(app).post('/api/v1/bulk-screening-jobs');

    expect(response.status).toBe(400);
  });

  it('returns 400 when file has wrong MIME type (not CSV)', async () => {
    const { app } = buildApp();
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    const nonCsvPath = path.join(TEMP_DIR, `test-${Date.now()}.json`);
    fs.writeFileSync(nonCsvPath, 'not,csv\ndata\n', 'utf-8');

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', nonCsvPath, { contentType: 'application/json' });

    expect(response.status).toBe(400);
  });

  it('returns 413 when the file exceeds the size limit', async () => {
    const { app } = buildApp();
    const bigContent = 'customer_id,name\n' + 'x'.repeat(6_000_000) + ',Alice\n';
    const csvPath = writeCsvFile(bigContent);

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'text/csv' });

    expect(response.status).toBe(413);
  });

  it('returns 401 when no auth context is attached', async () => {
    const { app } = buildApp(null);
    const csvPath = writeCsvFile('customer_id,name\nabc,Alice\n');

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'text/csv' });

    expect(response.status).toBe(401);
  });

  it('accepts application/csv content-type', async () => {
    const { app } = buildApp();
    const csvPath = writeCsvFile('customer_id,name\nabc123,Alice\n');

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'application/csv' });

    expect(response.status).toBe(202);
  });

  it('accepts text/plain content-type', async () => {
    const { app } = buildApp();
    const csvPath = writeCsvFile('customer_id,name\nabc123,Alice\n');

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'text/plain' });

    expect(response.status).toBe(202);
  });

  it('accepts a .csv originalname with text/plain content-type from OS detection', async () => {
    const { app } = buildApp();
    const csvPath = writeCsvFile('customer_id,name\nabc123,Alice\n');

    const response = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, 'upload.csv');

    expect(response.status).toBe(202);
  });
});

describe('GET /api/v1/bulk-screening-jobs/:id', () => {
  it('returns 200 with job fields when the job belongs to the caller org', async () => {
    const { app, jobRepo } = buildApp();
    const csvPath = writeCsvFile('customer_id,name\nabc123,Alice\n');

    const submitRes = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'text/csv' });
    const jobId = submitRes.body.id as string;

    const response = await request(app).get(`/api/v1/bulk-screening-jobs/${jobId}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(jobId);
    expect(response.body.status).toBe('PENDING');
    expect(typeof response.body.totalRows).toBe('number');
    expect(typeof response.body.processedRows).toBe('number');
    expect(typeof response.body.errors).toBe('string');
    expect(JSON.stringify(response.body)).not.toContain('filePath');
    expect(JSON.stringify(response.body)).not.toContain('file_path');
  });

  it('returns 404 for a job that belongs to another org', async () => {
    const { app } = buildApp();
    const csvPath = writeCsvFile('customer_id,name\nabc123,Alice\n');

    // Submit as ORG_1
    const submitRes = await request(app)
      .post('/api/v1/bulk-screening-jobs')
      .attach('file', csvPath, { contentType: 'text/csv' });
    const jobId = submitRes.body.id as string;

    // GET as ORG_2 — different org, should be 404
    const { app: appOrg2 } = buildApp(() =>
      createAuthContext({ userId: oid('analyst-2'), organizationId: ORG_2, actorType: 'USER' }),
    );
    const response = await request(appOrg2).get(`/api/v1/bulk-screening-jobs/${jobId}`);

    expect(response.status).toBe(404);
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = buildApp();

    const response = await request(app).get(`/api/v1/bulk-screening-jobs/${oid('no-such-job')}`);

    expect(response.status).toBe(404);
  });

  it('returns 404 for a malformed (non-ObjectId) id', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/v1/bulk-screening-jobs/not-a-valid-id');

    expect(response.status).toBe(404);
  });

  it('returns 401 when no auth context is attached', async () => {
    const { app: appNoAuth } = buildApp(null);

    const response = await request(appNoAuth).get(`/api/v1/bulk-screening-jobs/${oid('job-1')}`);

    expect(response.status).toBe(401);
  });
});
