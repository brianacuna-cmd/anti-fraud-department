import type { ObjectId } from 'mongodb';

/**
 * Mongo document shape for `scheduled_jobs` (observational catalog).
 * `_id` is the branded ScheduledJobId, `organization_id` a nullable ObjectId
 * FK to `organizations` (null = platform-wide). Instant fields are BSON `Date`.
 */
export interface ScheduledJobDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId | null;
  readonly name: string;
  readonly description: string;
  readonly cron_expression: string;
  readonly enabled: boolean;
  readonly last_run_at: Date | null;
  readonly next_run_at: Date | null;
  readonly last_result: string | null;
  readonly last_error: string | null;
  readonly created_at: Date;
}
