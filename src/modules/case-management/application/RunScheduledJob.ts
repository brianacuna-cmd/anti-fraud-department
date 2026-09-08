import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { ScheduledJobRepository } from '../../../shared/scheduled-jobs/ScheduledJobRepository.js';
import type { ScheduledJobResult } from '../../../shared/scheduled-jobs/ScheduledJobResult.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';
import { scheduledJobNotFound } from '../domain/errors/CaseManagementError.js';

export type ScheduledJobName =
  | 'sla_sweep'
  | 'outbox_publish'
  | 'customer_outgoing_webhook_dispatch'
  | 'directory_sync'
  | 'wallet_sanctions_rescreen';

export type ScheduledJobRunnerRegistry = Record<ScheduledJobName, () => Promise<unknown>>;

export interface RunScheduledJobInput {
  readonly auth: AuthContext;
  readonly jobName: string;
}

export interface RunScheduledJobDeps {
  readonly catalog: ScheduledJobRepository;
  readonly runners: ScheduledJobRunnerRegistry;
  readonly unitOfWork: UnitOfWork;
  readonly auditRecorder: AuditRecorder;
}

export interface RunScheduledJobResult {
  readonly jobName: string;
  readonly lastResult: ScheduledJobResult;
}

/**
 * PLATFORM_ADMIN force-run of a seeded catalog job. Auth first, then closed
 * registry, then catalog existence (`enabled` is ignored). Infers
 * `lastResult` from the injected runner (resolve → SUCCESS, throw → FAILED).
 * Catalog FAILED writes are the runner's job (`recordAround` in composition).
 * Audit is written after the job in a separate unit-of-work transaction with
 * `organizationId` null — it cannot join the job's own writes.
 */
export function createRunScheduledJobUseCase(deps: RunScheduledJobDeps) {
  return async function runScheduledJob(input: RunScheduledJobInput): Promise<RunScheduledJobResult> {
    requirePlatformAdmin(input.auth);

    const runner = lookupRunner(deps.runners, input.jobName);
    if (runner === undefined) {
      throw scheduledJobNotFound(input.jobName);
    }

    const catalogRow = await deps.catalog.findByName(input.jobName);
    if (catalogRow === null) {
      throw scheduledJobNotFound(input.jobName);
    }

    const lastResult = await invokeRunner(runner);

    await deps.unitOfWork.withTransaction(async (tx) => {
      await deps.auditRecorder.record(
        {
          organizationId: null,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'SCHEDULED_JOB_RUN',
          resource: 'scheduled_job',
          resourceId: input.jobName,
          detail: { jobName: input.jobName, lastResult },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );
    });

    return { jobName: input.jobName, lastResult };
  };
}

export type RunScheduledJobService = ReturnType<typeof createRunScheduledJobUseCase>;

function lookupRunner(
  runners: ScheduledJobRunnerRegistry,
  jobName: string,
): (() => Promise<unknown>) | undefined {
  if (!Object.hasOwn(runners, jobName)) {
    return undefined;
  }
  return runners[jobName as ScheduledJobName];
}

async function invokeRunner(runner: () => Promise<unknown>): Promise<ScheduledJobResult> {
  try {
    await runner();
    return 'SUCCESS';
  } catch {
    return 'FAILED';
  }
}
