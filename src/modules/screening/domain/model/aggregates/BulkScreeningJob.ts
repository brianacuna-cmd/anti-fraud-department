import type { Instant } from '../../../../../shared/time/Instant.js';
import type { BulkScreeningJobId } from '../value-objects/BulkScreeningJobId.js';
import type { BulkScreeningJobStatus } from '../value-objects/BulkScreeningJobStatus.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

const ERRORS_MAX_CHARS = 16_384;

export interface BulkScreeningJobProps {
  readonly id: BulkScreeningJobId;
  readonly organizationId: string;
  readonly filePath: string;
  readonly status: BulkScreeningJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  /** Accumulated row error messages (up to ERRORS_MAX_CHARS), ending with `... N more errors` when truncated. */
  readonly errors: string;
  /** Count of omitted error messages after the cap was reached. */
  readonly omitted: number;
  readonly createdBy: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateBulkScreeningJobInput {
  readonly id: BulkScreeningJobId;
  readonly organizationId: string;
  readonly filePath: string;
  readonly totalRows: number;
  readonly createdBy: string;
  readonly now: Instant;
}

export class BulkScreeningJob {
  private constructor(private readonly props: BulkScreeningJobProps) {}

  static create(input: CreateBulkScreeningJobInput): BulkScreeningJob {
    return new BulkScreeningJob({
      id: input.id,
      organizationId: input.organizationId,
      filePath: input.filePath,
      status: 'PENDING',
      totalRows: input.totalRows,
      processedRows: 0,
      errors: '',
      omitted: 0,
      createdBy: input.createdBy,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: BulkScreeningJobProps): BulkScreeningJob {
    return new BulkScreeningJob(props);
  }

  get id(): BulkScreeningJobId { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get filePath(): string { return this.props.filePath; }
  get status(): BulkScreeningJobStatus { return this.props.status; }
  get totalRows(): number { return this.props.totalRows; }
  get processedRows(): number { return this.props.processedRows; }
  get errors(): string { return this.props.errors; }
  get omitted(): number { return this.props.omitted; }
  get createdBy(): string { return this.props.createdBy; }
  get createdAt(): Instant { return this.props.createdAt; }
  get updatedAt(): Instant { return this.props.updatedAt; }

  toProps(): BulkScreeningJobProps { return this.props; }

  /** PENDING → PROCESSING. */
  startProcessing(now: Instant): BulkScreeningJob {
    if (this.props.status !== 'PENDING') {
      throw invariantViolation(
        `Cannot transition BulkScreeningJob from "${this.props.status}" to "PROCESSING"`,
        { current: this.props.status, next: 'PROCESSING' },
      );
    }
    return this.with({ status: 'PROCESSING', updatedAt: now });
  }

  /** PROCESSING → COMPLETED. */
  complete(now: Instant): BulkScreeningJob {
    if (this.props.status !== 'PROCESSING') {
      throw invariantViolation(
        `Cannot transition BulkScreeningJob from "${this.props.status}" to "COMPLETED"`,
        { current: this.props.status, next: 'COMPLETED' },
      );
    }
    return this.with({ status: 'COMPLETED', updatedAt: now });
  }

  /** PROCESSING → FAILED. */
  fail(now: Instant): BulkScreeningJob {
    if (this.props.status !== 'PROCESSING') {
      throw invariantViolation(
        `Cannot transition BulkScreeningJob from "${this.props.status}" to "FAILED"`,
        { current: this.props.status, next: 'FAILED' },
      );
    }
    return this.with({ status: 'FAILED', updatedAt: now });
  }

  /**
   * Appends a row error message. Capped at 16 384 characters total.
   * When the cap is exceeded, appends `... N more errors` and stops
   * accumulating further content (only the counter grows).
   */
  appendError(msg: string): BulkScreeningJob {
    if (this.props.omitted > 0) {
      const newOmitted = this.props.omitted + 1;
      const markerIdx = this.props.errors.lastIndexOf('\n...');
      const base =
        markerIdx >= 0 ? this.props.errors.slice(0, markerIdx) : this.props.errors;
      return this.with({
        errors: base ? `${base}\n... ${newOmitted} more errors` : `... ${newOmitted} more errors`,
        omitted: newOmitted,
      });
    }

    const next = this.props.errors ? `${this.props.errors}\n${msg}` : msg;
    if (next.length <= ERRORS_MAX_CHARS) {
      return this.with({ errors: next, omitted: 0 });
    }

    const base = this.props.errors;
    return this.with({
      errors: base ? `${base}\n... 1 more errors` : '... 1 more errors',
      omitted: 1,
    });
  }

  private with(changes: Partial<BulkScreeningJobProps>): BulkScreeningJob {
    return new BulkScreeningJob({ ...this.props, ...changes });
  }
}
