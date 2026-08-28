import type { Instant } from '../time/Instant.js';
import type { ScheduledJobId } from './ScheduledJobId.js';
import { createScheduledJobResult, type ScheduledJobResult } from './ScheduledJobResult.js';
import { scheduledJobInvariant } from './ScheduledJobError.js';

export interface ScheduledJobProps {
  readonly id: ScheduledJobId;
  readonly organizationId: string | null;
  readonly name: string;
  readonly description: string;
  readonly cronExpression: string;
  readonly enabled: boolean;
  readonly lastRunAt: Instant | null;
  readonly nextRunAt: Instant | null;
  readonly lastResult: ScheduledJobResult | null;
  readonly lastError: string | null;
  readonly createdAt: Instant;
}

export interface CreateScheduledJobInput {
  readonly id: ScheduledJobId;
  readonly organizationId: string | null;
  readonly name: string;
  readonly description: string;
  readonly cronExpression: string;
  readonly enabled?: boolean;
  readonly now: Instant;
}

export interface RecordRunInput {
  readonly result: string;
  readonly lastError: string | null;
  readonly nextRunAt: Instant;
  readonly now: Instant;
}

/**
 * Observational catalog row (`scheduled_jobs`). One document per `name` —
 * uniqueness is enforced at the repository/index layer, never here.
 * `enabled` is persisted but does not gate ticks.
 */
export class ScheduledJob {
  private constructor(private readonly props: ScheduledJobProps) {}

  static create(input: CreateScheduledJobInput): ScheduledJob {
    assertNonEmpty('name', input.name);
    return new ScheduledJob({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      cronExpression: input.cronExpression,
      enabled: input.enabled ?? true,
      lastRunAt: null,
      nextRunAt: null,
      lastResult: null,
      lastError: null,
      createdAt: input.now,
    });
  }

  static rehydrate(props: ScheduledJobProps): ScheduledJob {
    return new ScheduledJob(props);
  }

  get id(): ScheduledJobId {
    return this.props.id;
  }

  get organizationId(): string | null {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string {
    return this.props.description;
  }

  get cronExpression(): string {
    return this.props.cronExpression;
  }

  get enabled(): boolean {
    return this.props.enabled;
  }

  get lastRunAt(): Instant | null {
    return this.props.lastRunAt;
  }

  get nextRunAt(): Instant | null {
    return this.props.nextRunAt;
  }

  get lastResult(): ScheduledJobResult | null {
    return this.props.lastResult;
  }

  get lastError(): string | null {
    return this.props.lastError;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  /**
   * Records one tick on this named row. SUCCESS clears `lastError`; FAILED
   * keeps the provided error. Incoming `ERROR` is stored as FAILED.
   */
  recordRun(input: RecordRunInput): ScheduledJob {
    const lastResult = createScheduledJobResult(input.result);
    return new ScheduledJob({
      ...this.props,
      lastRunAt: input.now,
      nextRunAt: input.nextRunAt,
      lastResult,
      lastError: lastResult === 'SUCCESS' ? null : input.lastError,
    });
  }

  toProps(): ScheduledJobProps {
    return this.props;
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw scheduledJobInvariant(`ScheduledJob ${field} must be a non-empty string`, { field, value });
  }
}
