import { ObjectId } from 'mongodb';
import { fromDate, toDate, type Instant } from '../../time/Instant.js';
import { ScheduledJob } from '../ScheduledJob.js';
import { createScheduledJobId } from '../ScheduledJobId.js';
import { createScheduledJobResult } from '../ScheduledJobResult.js';
import type { ScheduledJobDocument } from './ScheduledJobDocument.js';

const instantToDate = (value: Instant | null): Date | null => (value === null ? null : toDate(value));
const dateToInstant = (value: Date | null | undefined): Instant | null =>
  value == null ? null : fromDate(value);

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(job: ScheduledJob): ScheduledJobDocument {
  return {
    _id: new ObjectId(job.id),
    organization_id: job.organizationId === null ? null : new ObjectId(job.organizationId),
    name: job.name,
    description: job.description,
    cron_expression: job.cronExpression,
    enabled: job.enabled,
    last_run_at: instantToDate(job.lastRunAt),
    next_run_at: instantToDate(job.nextRunAt),
    last_result: job.lastResult,
    last_error: job.lastError,
    created_at: toDate(job.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). Incoming `ERROR` last_result becomes FAILED. */
export function toDomain(document: ScheduledJobDocument): ScheduledJob {
  return ScheduledJob.rehydrate({
    id: createScheduledJobId(document._id.toString()),
    organizationId: document.organization_id === null ? null : document.organization_id.toString(),
    name: document.name,
    description: document.description,
    cronExpression: document.cron_expression,
    enabled: document.enabled,
    lastRunAt: dateToInstant(document.last_run_at),
    nextRunAt: dateToInstant(document.next_run_at),
    lastResult: document.last_result == null ? null : createScheduledJobResult(document.last_result),
    lastError: document.last_error ?? null,
    createdAt: fromDate(document.created_at),
  });
}
