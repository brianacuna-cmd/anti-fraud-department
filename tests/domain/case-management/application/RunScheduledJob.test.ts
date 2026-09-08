import { oid } from '../../../support/oid.js';
import {
  createRunScheduledJobUseCase,
  type ScheduledJobName,
  type ScheduledJobRunnerRegistry,
} from '../../../../src/modules/case-management/application/RunScheduledJob.js';
import { InMemoryUnitOfWork, ThrowingUnitOfWork } from '../../../helpers/case-management/InMemoryUnitOfWork.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { ScheduledJob } from '../../../../src/shared/scheduled-jobs/ScheduledJob.js';
import { createScheduledJobId } from '../../../../src/shared/scheduled-jobs/ScheduledJobId.js';
import type {
  RecordScheduledJobRunInput,
  ScheduledJobRepository,
  SeedScheduledJobInput,
} from '../../../../src/shared/scheduled-jobs/ScheduledJobRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext, type AuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { UnitOfWork } from '../../../../src/modules/case-management/domain/ports/UnitOfWork.js';

const NOW = fromDate(new Date('2026-08-31T12:00:00.000Z'));
const LAST_RUN = fromDate(new Date('2026-08-31T11:00:00.000Z'));
const NEXT_RUN = fromDate(new Date('2026-08-31T13:00:00.000Z'));

const FIVE_NAMES: readonly ScheduledJobName[] = [
  'sla_sweep',
  'outbox_publish',
  'customer_outgoing_webhook_dispatch',
  'directory_sync',
  'wallet_sanctions_rescreen',
];

const PLATFORM_ADMIN = createAuthContext({
  userId: oid('platform-admin-1'),
  organizationId: null,
  actorType: 'PLATFORM_ADMIN',
  ipAddress: '203.0.113.10',
});

const SUPERVISOR = createAuthContext({
  userId: oid('supervisor-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});

const TENANT_ADMIN = createAuthContext({
  userId: oid('tenant-admin-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'ADMIN',
});

const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: oid('org-1'),
  actorType: 'USER',
  roleId: 'ANALYST',
});

const ORGANIZATION = createAuthContext({
  userId: oid('org-actor-1'),
  organizationId: oid('org-1'),
  actorType: 'ORGANIZATION',
});

class FakeCatalog implements ScheduledJobRepository {
  readonly jobs = new Map<string, ScheduledJob>();
  readonly findByNameCalls: string[] = [];

  async seed(_input: SeedScheduledJobInput): Promise<void> {
    /* unused */
  }

  async recordRun(_input: RecordScheduledJobRunInput): Promise<void> {
    /* unused — catalog FAILED is the injected runner's job */
  }

  async findByName(name: string): Promise<ScheduledJob | null> {
    this.findByNameCalls.push(name);
    return this.jobs.get(name) ?? null;
  }
}

function catalogJob(
  name: ScheduledJobName,
  extras: { enabled?: boolean; lastResult?: 'SUCCESS' | 'FAILED' } = {},
): ScheduledJob {
  const created = ScheduledJob.create({
    id: createScheduledJobId(oid(`job-${name}`)),
    organizationId: null,
    name,
    description: `${name} catalog row`,
    cronExpression: 'every 60s',
    enabled: extras.enabled ?? true,
    now: NOW,
  });
  if (extras.lastResult === undefined) {
    return created;
  }
  return created.recordRun({
    result: extras.lastResult,
    lastError: extras.lastResult === 'FAILED' ? 'previous tick failed' : null,
    nextRunAt: NEXT_RUN,
    now: LAST_RUN,
  });
}

interface BuildDeps {
  catalog?: FakeCatalog;
  runners?: ScheduledJobRunnerRegistry;
  unitOfWork?: UnitOfWork;
  auditRecorder?: InMemoryCaseManagementAuditRecorder;
  order?: string[];
}

function resolvingRunners(order: string[], overrides: Partial<ScheduledJobRunnerRegistry> = {}): ScheduledJobRunnerRegistry {
  const make = (name: ScheduledJobName) => async () => {
    order.push(`job:${name}`);
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

function build(overrides: BuildDeps = {}) {
  const order = overrides.order ?? [];
  const catalog = overrides.catalog ?? new FakeCatalog();
  const runners = overrides.runners ?? resolvingRunners(order);
  const unitOfWork = overrides.unitOfWork ?? new InMemoryUnitOfWork();
  const auditRecorder = overrides.auditRecorder ?? new InMemoryCaseManagementAuditRecorder();

  const originalWithTransaction = unitOfWork.withTransaction.bind(unitOfWork);
  unitOfWork.withTransaction = async (work) => {
    order.push('audit-tx');
    return originalWithTransaction(work);
  };

  if (!overrides.catalog) {
    for (const name of FIVE_NAMES) {
      catalog.jobs.set(name, catalogJob(name));
    }
  }

  return {
    catalog,
    runners,
    unitOfWork,
    auditRecorder,
    order,
    runScheduledJob: createRunScheduledJobUseCase({ catalog, runners, unitOfWork, auditRecorder }),
  };
}

describe('createRunScheduledJobUseCase', () => {
  it.each([
    ['USER SUPERVISOR', SUPERVISOR],
    ['USER ADMIN', TENANT_ADMIN],
    ['USER ANALYST', ANALYST],
    ['ORGANIZATION', ORGANIZATION],
  ] as const)(
    'throws FORBIDDEN_CROSS_TENANT for %s before catalog or runners',
    async (_label: string, auth: AuthContext) => {
      const { runScheduledJob, catalog, order } = build();

      await expect(runScheduledJob({ auth, jobName: 'sla_sweep' })).rejects.toMatchObject({
        code: 'FORBIDDEN_CROSS_TENANT',
      });

      expect(catalog.findByNameCalls).toEqual([]);
      expect(order.filter((step) => step.startsWith('job:'))).toEqual([]);
    },
  );

  it('throws FORBIDDEN_CROSS_TENANT not SCHEDULED_JOB_NOT_FOUND for SUPERVISOR on an unknown name', async () => {
    const { runScheduledJob, catalog, order } = build();

    await expect(runScheduledJob({ auth: SUPERVISOR, jobName: 'unknown_job' })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });

    expect(catalog.findByNameCalls).toEqual([]);
    expect(order).toEqual([]);
  });

  it('throws SCHEDULED_JOB_NOT_FOUND for an unknown name and does not invoke a runner', async () => {
    const { runScheduledJob, catalog, order, auditRecorder } = build();

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'unknown_job' })).rejects.toMatchObject({
      code: 'SCHEDULED_JOB_NOT_FOUND',
    });

    expect(catalog.findByNameCalls).toEqual([]);
    expect(order.filter((step) => step.startsWith('job:'))).toEqual([]);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('throws SCHEDULED_JOB_NOT_FOUND for Object.prototype keys that are not catalog names', async () => {
    const { runScheduledJob, catalog, order } = build();

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'toString' })).rejects.toMatchObject({
      code: 'SCHEDULED_JOB_NOT_FOUND',
    });

    expect(catalog.findByNameCalls).toEqual([]);
    expect(order.filter((step) => step.startsWith('job:'))).toEqual([]);
  });

  it('throws SCHEDULED_JOB_NOT_FOUND when the catalog row is missing and does not invoke a runner', async () => {
    const catalog = new FakeCatalog();
    const order: string[] = [];
    const { runScheduledJob } = build({ catalog, order });

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'sla_sweep' })).rejects.toMatchObject({
      code: 'SCHEDULED_JOB_NOT_FOUND',
    });

    expect(catalog.findByNameCalls).toEqual(['sla_sweep']);
    expect(order.filter((step) => step.startsWith('job:'))).toEqual([]);
  });

  it('invokes the runner when enabled is false', async () => {
    const catalog = new FakeCatalog();
    catalog.jobs.set('directory_sync', catalogJob('directory_sync', { enabled: false }));
    catalog.jobs.set('wallet_sanctions_rescreen', catalogJob('wallet_sanctions_rescreen', { enabled: false }));
    const order: string[] = [];
    const { runScheduledJob } = build({ catalog, order });

    await expect(
      runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'directory_sync' }),
    ).resolves.toEqual({ jobName: 'directory_sync', lastResult: 'SUCCESS' });

    expect(order.filter((step) => step.startsWith('job:'))).toEqual(['job:directory_sync']);
  });

  it('returns FAILED without rethrowing when the injected runner throws', async () => {
    const order: string[] = [];
    const runners = resolvingRunners(order, {
      sla_sweep: async () => {
        order.push('job:sla_sweep');
        throw new Error('sweep exploded');
      },
    });
    const { runScheduledJob, auditRecorder } = build({ runners, order });

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'sla_sweep' })).resolves.toEqual({
      jobName: 'sla_sweep',
      lastResult: 'FAILED',
    });

    expect(order).toEqual(['job:sla_sweep', 'audit-tx']);
    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'SCHEDULED_JOB_RUN',
      resource: 'scheduled_job',
      resourceId: 'sla_sweep',
      organizationId: null,
      detail: { jobName: 'sla_sweep', lastResult: 'FAILED' },
    });
  });

  it('returns SUCCESS for PLATFORM_ADMIN when the runner resolves', async () => {
    const order: string[] = [];
    const { runScheduledJob, auditRecorder } = build({ order });

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'outbox_publish' })).resolves.toEqual({
      jobName: 'outbox_publish',
      lastResult: 'SUCCESS',
    });

    expect(order).toEqual(['job:outbox_publish', 'audit-tx']);
    const events = auditRecorder.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'SCHEDULED_JOB_RUN',
      resource: 'scheduled_job',
      resourceId: 'outbox_publish',
      organizationId: null,
      actorId: PLATFORM_ADMIN.userId,
      ipAddress: PLATFORM_ADMIN.ipAddress,
      detail: { jobName: 'outbox_publish', lastResult: 'SUCCESS' },
    });
  });

  it('returns SUCCESS when a FAILED catalog row is run and the runner resolves', async () => {
    const catalog = new FakeCatalog();
    catalog.jobs.set('sla_sweep', catalogJob('sla_sweep', { lastResult: 'FAILED' }));
    const { runScheduledJob } = build({ catalog });

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'sla_sweep' })).resolves.toEqual({
      jobName: 'sla_sweep',
      lastResult: 'SUCCESS',
    });
  });

  it.each(FIVE_NAMES)('invokes the recorded runner for %s', async (jobName) => {
    const order: string[] = [];
    const { runScheduledJob } = build({ order });

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName })).resolves.toEqual({
      jobName,
      lastResult: 'SUCCESS',
    });

    expect(order.filter((step) => step.startsWith('job:'))).toEqual([`job:${jobName}`]);
  });

  it('writes platform audit after the job in a separate transaction', async () => {
    const order: string[] = [];
    const unitOfWork = new InMemoryUnitOfWork();
    const { runScheduledJob, auditRecorder } = build({ order, unitOfWork });

    await runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'outbox_publish' });

    expect(order).toEqual(['job:outbox_publish', 'audit-tx']);
    expect(unitOfWork.transactionCount).toBe(1);
    expect(auditRecorder.all()[0]?.organizationId).toBeNull();
  });

  it('surfaces an audit failure after a successful job without undoing the run', async () => {
    const order: string[] = [];
    const { runScheduledJob } = build({ order, unitOfWork: new ThrowingUnitOfWork() });

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'outbox_publish' })).rejects.toThrow(
      'simulated transaction abort',
    );
    expect(order).toEqual(['job:outbox_publish', 'audit-tx']);
  });

  it('surfaces CaseManagementError for unknown names', async () => {
    const { runScheduledJob } = build();

    await expect(runScheduledJob({ auth: PLATFORM_ADMIN, jobName: 'unknown_job' })).rejects.toBeInstanceOf(
      CaseManagementError,
    );
  });
});
