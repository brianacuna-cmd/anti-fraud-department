import type { Instant } from '../../../../../shared/time/Instant.js';
import type { InboundWebhookSecretId } from '../value-objects/InboundWebhookSecretId.js';
import { createPaymentProvider, type PaymentProvider } from '../value-objects/PaymentProvider.js';
import { invariantViolation } from '../../errors/IngestError.js';

export interface InboundWebhookSecretProps {
  readonly id: InboundWebhookSecretId;
  readonly organizationId: string;
  readonly provider: PaymentProvider;
  readonly ciphertext: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateInboundWebhookSecretInput {
  readonly id: InboundWebhookSecretId;
  readonly organizationId: string;
  readonly provider: string;
  readonly ciphertext: string;
  readonly now: Instant;
}

/**
 * Per-org per-provider inbound webhook secret. Plaintext is never stored;
 * uniqueness `(organizationId, provider)` is enforced at the index layer.
 */
export class InboundWebhookSecret {
  private constructor(private readonly props: InboundWebhookSecretProps) {}

  static create(input: CreateInboundWebhookSecretInput): InboundWebhookSecret {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('ciphertext', input.ciphertext);
    return new InboundWebhookSecret({
      id: input.id,
      organizationId: input.organizationId,
      provider: createPaymentProvider(input.provider),
      ciphertext: input.ciphertext,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  static rehydrate(props: InboundWebhookSecretProps): InboundWebhookSecret {
    return new InboundWebhookSecret(props);
  }

  get id(): InboundWebhookSecretId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get provider(): PaymentProvider {
    return this.props.provider;
  }

  get ciphertext(): string {
    return this.props.ciphertext;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): InboundWebhookSecretProps {
    return this.props;
  }

  replaceCiphertext(ciphertext: string, now: Instant): InboundWebhookSecret {
    assertNonEmpty('ciphertext', ciphertext);
    return new InboundWebhookSecret({
      ...this.props,
      ciphertext,
      updatedAt: now,
    });
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`InboundWebhookSecret ${field} must be a non-empty string`, {
      field,
      value,
    });
  }
}
