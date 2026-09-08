import { scheduledJobInvariant } from './ScheduledJobError.js';

/** Outcome of the most recent catalogued tick. Null before the first run. */
export type ScheduledJobResult = 'SUCCESS' | 'FAILED';

export const SCHEDULED_JOB_RESULTS = ['SUCCESS', 'FAILED'] as const;

/**
 * Incoming `ERROR` is a legacy synonym and MUST persist as `FAILED`.
 * Null (never-run) is represented by the aggregate field, not this factory.
 */
export function createScheduledJobResult(value: string): ScheduledJobResult {
  if (value === 'ERROR') {
    return 'FAILED';
  }
  if (value === 'SUCCESS' || value === 'FAILED') {
    return value;
  }
  throw scheduledJobInvariant('ScheduledJobResult must be SUCCESS or FAILED', { value });
}
