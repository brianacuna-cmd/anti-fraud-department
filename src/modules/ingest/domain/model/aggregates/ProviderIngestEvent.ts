import type { Instant } from '../../../../../shared/time/Instant.js';
import type { ProviderIngestEventId } from '../value-objects/ProviderIngestEventId.js';
import { createPaymentProvider, type PaymentProvider } from '../value-objects/PaymentProvider.js';
import {
  createInitialProviderIngestStatus,
  type ProviderIngestStatus,
} from '../value-objects/ProviderIngestStatus.js';
import { invariantViolation } from '../../errors/IngestError.js';

export interface ProviderIngestEventProps {
  readonly id: ProviderIngestEventId;
  readonly organizationId: string;
  readonly provider: PaymentProvider;
  readonly providerEventId: string;
  readonly status: ProviderIngestStatus;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateProviderIngestEventInput {
  readonly id: ProviderIngestEventId;
  readonly organizationId: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly status: string;
  readonly now: Instant;
}

/**
 * Idempotency row for a provider webhook delivery. Unique on
 * `(organizationId, provider, providerEventId)` at the index layer.
 */
export class ProviderIngestEvent {
  private constructor(private readonly props: ProviderIngestEventProps) {}

  static create(input: CreateProviderIngestEventInput): ProviderIngestEvent {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('providerEventId', input.providerEventId);
    return new ProviderIngestEvent({
      id: input.id,
      organizationId: input.organizationId,
      provider: createPaymentProvider(input.provider),
      providerEventId: input.providerEventId,
      status: createInitialProviderIngestStatus(input.status),
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: ProviderIngestEventProps): ProviderIngestEvent {
    return new ProviderIngestEvent(props);
  }

  get id(): ProviderIngestEventId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get provider(): PaymentProvider {
    return this.props.provider;
  }

  get providerEventId(): string {
    return this.props.providerEventId;
  }

  get status(): ProviderIngestStatus {
    return this.props.status;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): ProviderIngestEventProps {
    return this.props;
  }

  markProcessed(now: Instant): ProviderIngestEvent {
    assertStatus(this.props.status, 'RECEIVED', 'PROCESSED');
    return new ProviderIngestEvent({
      ...this.props,
      status: 'PROCESSED',
      updatedAt: now,
    });
  }

  markFailed(now: Instant): ProviderIngestEvent {
    assertStatus(this.props.status, 'RECEIVED', 'FAILED');
    return new ProviderIngestEvent({
      ...this.props,
      status: 'FAILED',
      updatedAt: now,
    });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`ProviderIngestEvent ${field} must be a non-empty string`, {
      field,
      value,
    });
  }
}

function assertStatus(current: ProviderIngestStatus, expected: ProviderIngestStatus, next: ProviderIngestStatus): void {
  if (current !== expected) {
    throw invariantViolation(`cannot transition ProviderIngestEvent from "${current}" to "${next}"`, {
      current,
      next,
    });
  }
}
