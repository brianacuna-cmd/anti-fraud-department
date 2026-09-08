/**
 * HTTP contract tests for `scheduledJobAdminRouter`.
 *
 * Threat-matrix coverage (admin-job-run design):
 *  - No auth → 401 (UNAUTHENTICATED)
 *  - USER / ORGANIZATION → 403 (FORBIDDEN_CROSS_TENANT) before name lookup
 *  - PLATFORM_ADMIN unknown name → 404 (SCHEDULED_JOB_NOT_FOUND)
 *  - PLATFORM_ADMIN → 200 `{ jobName, lastResult: 'SUCCESS' }`
 *  - Runner throw → 200 `{ lastResult: 'FAILED' }` not 500
 */
import { Router, type Request, type NextFunction, type Response } from 'express';
import request from 'supertest';
import { createApp } from '../../../../src/shared/http/createApp.js';
import { createErrorHandler } from '../../../../src/shared/http/errorHandler.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { caseManagementErrorStatus } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/errorStatus.js';
import { scheduledJobAdminRouter } from '../../../../src/modules/case-management/infrastructure/adapters/inbound/http/scheduledJobAdminRouter.js';
import {
  createRunScheduledJobUseCase,
  type ScheduledJobName,
  type ScheduledJobRunnerRegistry,
} from '../../../../src/modules/case-management/application/RunScheduledJob.js';
import { InMemoryUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { ScheduledJob } from '../../../../src/shared/scheduled-jobs/ScheduledJob.js';
import { createScheduledJobId } from '../../../../src/shared/scheduled-jobs/ScheduledJobId.js';
import type {
  RecordScheduledJobRunInput,
  ScheduledJobRepository,
  SeedScheduledJobInput,
} from '../../../../src/shared/scheduled-jobs/ScheduledJobRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-08-31T12:00:00.000Z'));
const RUN_PATH = (jobName: string) => `/api/v1/admin/jobs/${jobName}/run`;

const FIVE_NAMES: readonly ScheduledJobName[] = [
  'sla_sweep',
  'outbox_publish',
  'customer_outgoing_webhook_dispatch',
  'directory_sync',
  'wallet_sanctions_rescreen',
];

const PLATFORM_ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: null,
  actorType: 'PLATFORM_ADMIN',
  isPlatformAdmin: true,
});

const USER_ACTOR = createAuthContext({
  userId: oid('user-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});

const ORG_ACTOR = createAuthContext({
  userId: oid('org-1'),
  organizationId: oid('org-1'),
  actorType: 'ORGANIZATION',
});

class FakeCatalog implements ScheduledJobRepository {
  readonly jobs = new Map<string, ScheduledJob>();

  async seed(_input: SeedScheduledJobInput): Promise<void> {
    /* unused */
  }

  async recordRun(_input: RecordScheduledJobRunInput): Promise<void> {
    /* unused — catalog FAILED is the injected runner's job */
  }

  async findByName(name: string): Promise<ScheduledJob | null> {
    return this.jobs.get(name) ?? null;
  }
}

function catalogJob(name: ScheduledJobName): ScheduledJob {
  return ScheduledJob.create({
    id: createScheduledJobId(oid(`job-${name}`)),
    organizationId: null,
    name,
    description: `${name} catalog row`,
    cronExpression: 'every 60s',
    enabled: true,
    now: NOW,
  });
}

function resolvingRunners(
  invocations: string[],
  overrides: Partial<ScheduledJobRunnerRegistry> = {},
): ScheduledJobRunnerRegistry {
  const make = (name: ScheduledJobName) => async () => {
    invocations.push(name);
  };
  return {
    sla_sweep: make('sla_sweep'),
    outbox_publish: make('outbox_publish'),
    customer_outgoing_webhook_dispatch: make('customer_outgoing_webhook_dispatch'),
    directory_sync: make('directory_sync'),
    wallet_sanctions_rescreen: make('wallet_sanctions_rescreen'),
    ...overrides,
  };
}

interface BuildOpts {
  actor: AuthContext;
  runners?: ScheduledJobRunnerRegistry;
  invocations?: string[];
}

function buildApp(opts: BuildOpts) {
  const catalog = new FakeCatalog();
  for (const name of FIVE_NAMES) {
    catalog.jobs.set(name, catalogJob(name));
  }
  const invocations = opts.invocations ?? [];
  const runners = opts.runners ?? resolvingRunners(invocations);
  const runScheduledJob = createRunScheduledJobUseCase({
    catalog,
    runners,
    unitOfWork: new InMemoryUnitOfWork(),
    auditRecorder: new InMemoryCaseManagementAuditRecorder(),
  });

  const authMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    attachAuthContext(req, opts.actor);
    next();
  };

  const apiRouter = Router();
  apiRouter.use(authMiddleware);
  apiRouter.use(scheduledJobAdminRouter({ runScheduledJob }));

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: apiRouter }],
      errorHandler: createErrorHandler({
        UNAUTHENTICATED: 401,
        ...caseManagementErrorStatus,
      }),
    }),
    invocations,
  };
}

function buildUnauthenticatedApp() {
  const catalog = new FakeCatalog();
  const invocations: string[] = [];
  const runScheduledJob = createRunScheduledJobUseCase({
    catalog,
    runners: resolvingRunners(invocations),
    unitOfWork: new InMemoryUnitOfWork(),
    auditRecorder: new InMemoryCaseManagementAuditRecorder(),
  });

  const apiRouter = Router();
  apiRouter.use(scheduledJobAdminRouter({ runScheduledJob }));

  return {
    app: createApp({
      routers: [{ path: '/api/v1', router: apiRouter }],
      errorHandler: createErrorHandler({
        UNAUTHENTICATED: 401,
        ...caseManagementErrorStatus,
      }),
    }),
    invocations,
  };
}

describe('POST /api/v1/admin/jobs/:jobName/run', () => {
  it('returns 401 when no auth context is attached (UNAUTHENTICATED)', async () => {
    const { app, invocations } = buildUnauthenticatedApp();
    const res = await request(app).post(RUN_PATH('sla_sweep'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(invocations).toEqual([]);
  });

  it('returns 403 for USER actor (FORBIDDEN_CROSS_TENANT)', async () => {
    const invocations: string[] = [];
    const { app } = buildApp({ actor: USER_ACTOR, invocations });
    const res = await request(app).post(RUN_PATH('sla_sweep'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
    expect(invocations).toEqual([]);
  });

  it('returns 403 for ORGANIZATION actor (FORBIDDEN_CROSS_TENANT)', async () => {
    const invocations: string[] = [];
    const { app } = buildApp({ actor: ORG_ACTOR, invocations });
    const res = await request(app).post(RUN_PATH('sla_sweep'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
    expect(invocations).toEqual([]);
  });

  it('returns 403 not 404 when a SUPERVISOR posts an unknown jobName', async () => {
    const invocations: string[] = [];
    const { app } = buildApp({ actor: USER_ACTOR, invocations });
    const res = await request(app).post(RUN_PATH('unknown_job'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_CROSS_TENANT');
    expect(invocations).toEqual([]);
  });

  it('returns 404 SCHEDULED_JOB_NOT_FOUND for PLATFORM_ADMIN with an unknown name', async () => {
    const invocations: string[] = [];
    const { app } = buildApp({ actor: PLATFORM_ADMIN, invocations });
    const res = await request(app).post(RUN_PATH('unknown_job'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SCHEDULED_JOB_NOT_FOUND');
    expect(invocations).toEqual([]);
  });

  it('returns 200 { jobName, lastResult: SUCCESS } for PLATFORM_ADMIN', async () => {
    const invocations: string[] = [];
    const { app } = buildApp({ actor: PLATFORM_ADMIN, invocations });
    const res = await request(app).post(RUN_PATH('sla_sweep'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobName: 'sla_sweep', lastResult: 'SUCCESS' });
    expect(invocations).toEqual(['sla_sweep']);
  });

  it('returns 200 { lastResult: FAILED } not 500 when the runner throws', async () => {
    const invocations: string[] = [];
    const runners = resolvingRunners(invocations, {
      sla_sweep: async () => {
        invocations.push('sla_sweep');
        throw new Error('tick exploded');
      },
    });
    const { app } = buildApp({ actor: PLATFORM_ADMIN, runners, invocations });
    const res = await request(app).post(RUN_PATH('sla_sweep'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobName: 'sla_sweep', lastResult: 'FAILED' });
    expect(invocations).toEqual(['sla_sweep']);
  });

  it('returns 200 for each of the five closed-set names', async () => {
    const invocations: string[] = [];
    const { app } = buildApp({ actor: PLATFORM_ADMIN, invocations });
    for (const jobName of FIVE_NAMES) {
      const res = await request(app).post(RUN_PATH(jobName));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ jobName, lastResult: 'SUCCESS' });
    }
    expect(invocations).toEqual([...FIVE_NAMES]);
  });
});
