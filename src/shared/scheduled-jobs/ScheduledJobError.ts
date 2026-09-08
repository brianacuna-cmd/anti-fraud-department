import { DomainError } from '../kernel/DomainError.js';

/** Shared scheduled-jobs domain error (invariant violations on catalog value objects). */
export class ScheduledJobError extends DomainError {
  constructor(message: string, metadata: Readonly<Record<string, unknown>> = {}) {
    super('SCHEDULED_JOB_INVARIANT_VIOLATION', message, metadata);
  }
}

export function scheduledJobInvariant(
  message: string,
  metadata: Readonly<Record<string, unknown>> = {},
): ScheduledJobError {
  return new ScheduledJobError(message, metadata);
}
