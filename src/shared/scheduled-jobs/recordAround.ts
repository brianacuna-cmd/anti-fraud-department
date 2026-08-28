import type { Clock } from '../time/Clock.js';
import type { Instant } from '../time/Instant.js';
import type { ScheduledJobRepository } from './ScheduledJobRepository.js';
import type { ScheduledJobResult } from './ScheduledJobResult.js';

/** Truncate `last_error` to ~8 KiB so a huge stack cannot bloat the catalog row. */
const LAST_ERROR_LIMIT = 8 * 1024;

export interface RecordAroundMeta {
  readonly name: string;
  readonly recorder: ScheduledJobRepository;
  readonly clock: Clock;
  readonly nextRunAt: (now: Instant) => Instant;
  readonly onRecorderError?: (error: unknown) => void;
}

function formatLastError(error: unknown): string {
  const raw = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return raw.length > LAST_ERROR_LIMIT ? raw.slice(0, LAST_ERROR_LIMIT) : raw;
}

/**
 * Runs `job` first, then best-effort records SUCCESS or FAILED. Recorder I/O
 * is caught and logged; it never skips the job or replaces a job error.
 * Job failures are recorded as FAILED then rethrown.
 */
export async function recordAround<T>(job: () => Promise<T>, meta: RecordAroundMeta): Promise<T> {
  const persist = async (lastResult: ScheduledJobResult, lastError: string | null): Promise<void> => {
    try {
      const now = meta.clock.now();
      await meta.recorder.recordRun({
        name: meta.name,
        lastRunAt: now,
        lastResult,
        lastError,
        nextRunAt: meta.nextRunAt(now),
      });
    } catch (error) {
      if (meta.onRecorderError) {
        meta.onRecorderError(error);
      } else {
        console.error('[scheduled-jobs] recorder failed:', error);
      }
    }
  };

  try {
    const value = await job();
    await persist('SUCCESS', null);
    return value;
  } catch (jobError) {
    await persist('FAILED', formatLastError(jobError));
    throw jobError;
  }
}
