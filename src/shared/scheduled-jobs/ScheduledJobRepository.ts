import type { Instant } from '../time/Instant.js';
import type { ScheduledJobResult } from './ScheduledJobResult.js';

export interface SeedScheduledJobInput {
  readonly name: string;
  readonly description: string;
  readonly cronExpression: string;
  readonly enabled: boolean;
  readonly organizationId: string | null;
  readonly now: Instant;
}

export interface RecordScheduledJobRunInput {
  readonly name: string;
  readonly lastRunAt: Instant;
  readonly lastResult: ScheduledJobResult;
  readonly lastError: string | null;
  readonly nextRunAt: Instant;
}

/**
 * Observational catalog port. `seed` upserts labels/`enabled` by `name`.
 * `recordRun` upserts tick fields by `name`. Uniqueness is the unique index,
 * not a second app-level check. `created_at` is `$setOnInsert` only.
 */
export interface ScheduledJobRepository {
  seed(input: SeedScheduledJobInput): Promise<void>;
  recordRun(input: RecordScheduledJobRunInput): Promise<void>;
}
