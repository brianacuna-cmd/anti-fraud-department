import type { Instant } from '../../../../../shared/time/Instant.js';
import { invariantViolation } from '../../errors/RiskAssessmentError.js';
import type { PaymentActivityId } from '../value-objects/PaymentActivityId.js';

/**
 * What a payment event means for a customer's accumulated activity.
 *
 * - ATTEMPT: a payment tried (card charge, card transaction). Its `outcome`
 *   says whether it went through.
 * - CHARGEBACK: a dispute opened on a previous payment.
 * - FRAUD_WARNING: the provider flagged a payment as likely fraud before any
 *   dispute (Stripe early fraud warning, Coinflow suspected fraud).
 * - TRANSFER: money the customer moved out (Bridge transfer that reached a
 *   final state). `outcome` says whether it was delivered.
 */
export type PaymentActivityKind = 'ATTEMPT' | 'CHARGEBACK' | 'FRAUD_WARNING' | 'TRANSFER';

export type PaymentActivityOutcome = 'SUCCEEDED' | 'FAILED';

/** Where the row came from. CSV imports (Finturu) land in the same history as webhooks. */
export type PaymentActivitySource = 'WEBHOOK' | 'CSV_IMPORT';

const KINDS: ReadonlySet<string> = new Set<PaymentActivityKind>(['ATTEMPT', 'CHARGEBACK', 'FRAUD_WARNING', 'TRANSFER']);
const OUTCOMES: ReadonlySet<string> = new Set<PaymentActivityOutcome>(['SUCCEEDED', 'FAILED']);
const SOURCES: ReadonlySet<string> = new Set<PaymentActivitySource>(['WEBHOOK', 'CSV_IMPORT']);

export interface PaymentActivityProps {
  readonly id: PaymentActivityId;
  readonly organizationId: string;
  readonly customerId: string;
  readonly provider: string;
  /** Idempotency key within (organization, provider): the provider event id, or the CSV row's own id. */
  readonly providerEventId: string;
  /** The payment the event is about (Stripe charge id…). Lets a later dispute find its customer. */
  readonly providerReference: string | null;
  /**
   * Other provider ids of the same payment (Stripe PaymentIntent next to the
   * charge id). A Finturu payment link stores the PaymentIntent, so this is
   * what lets reconciliation find the payment of a link.
   */
  readonly relatedReferences: readonly string[];
  /**
   * The merchant that was paid: the Stripe connected account (`acct_…`) or the
   * Finturu user id. `null` when the provider does not say.
   */
  readonly merchantId: string | null;
  readonly providerEventType: string;
  readonly kind: PaymentActivityKind;
  /** Only for ATTEMPT. */
  readonly outcome: PaymentActivityOutcome | null;
  readonly amountCents: number;
  readonly currency: string;
  /** Decline category for failed attempts (see `shared/payments`). */
  readonly declineCategory: string | null;
  readonly cardCountry: string | null;
  readonly billingCountry: string | null;
  /**
   * Stripe card fingerprint: the same card gives the same value across
   * charges, without exposing the number. `null` when the provider has none.
   */
  readonly cardFingerprint: string | null;
  /** Where a TRANSFER went: destination wallet address or external account. */
  readonly counterparty: string | null;
  readonly source: PaymentActivitySource;
  /** When the payment happened at the provider — the clock every window counts on. */
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
}

export type CreatePaymentActivityInput = Omit<
  PaymentActivityProps,
  'kind' | 'outcome' | 'source' | 'relatedReferences' | 'merchantId' | 'cardFingerprint' | 'counterparty'
> & {
  readonly kind: string;
  readonly outcome: string | null;
  readonly source: string;
  readonly relatedReferences?: readonly string[];
  readonly merchantId?: string | null;
  readonly cardFingerprint?: string | null;
  readonly counterparty?: string | null;
};

/** One row of a customer's payment history. Append-only: never updated once recorded. */
export class PaymentActivity {
  private constructor(private readonly props: PaymentActivityProps) {}

  static create(input: CreatePaymentActivityInput): PaymentActivity {
    const REQUIRED = ['organizationId', 'customerId', 'provider', 'providerEventId', 'providerEventType'] as const;
    const blank = REQUIRED.find((field) => input[field].trim().length === 0);
    if (blank !== undefined) {
      throw invariantViolation(`PaymentActivity ${blank} must be a non-empty string`, { field: blank });
    }
    if (!KINDS.has(input.kind)) {
      throw invariantViolation('PaymentActivity kind must be ATTEMPT, CHARGEBACK, FRAUD_WARNING or TRANSFER', { kind: input.kind });
    }
    if (!SOURCES.has(input.source)) {
      throw invariantViolation('PaymentActivity source must be WEBHOOK or CSV_IMPORT', { source: input.source });
    }
    const kind = input.kind as PaymentActivityKind;
    const needsOutcome = kind === 'ATTEMPT' || kind === 'TRANSFER';
    if (needsOutcome && (input.outcome === null || !OUTCOMES.has(input.outcome))) {
      throw invariantViolation(`a ${kind} needs an outcome: SUCCEEDED or FAILED`, { outcome: input.outcome });
    }
    if (!Number.isFinite(input.amountCents)) {
      throw invariantViolation('PaymentActivity amountCents must be a number', { amountCents: input.amountCents });
    }
    return new PaymentActivity({
      ...input,
      kind,
      outcome: needsOutcome ? (input.outcome as PaymentActivityOutcome) : null,
      source: input.source as PaymentActivitySource,
      relatedReferences: [...new Set((input.relatedReferences ?? []).filter((r) => r.trim().length > 0))],
      merchantId: input.merchantId?.trim() ? input.merchantId.trim() : null,
      cardFingerprint: input.cardFingerprint?.trim() ? input.cardFingerprint.trim() : null,
      counterparty: input.counterparty?.trim() ? input.counterparty.trim().toLowerCase() : null,
      currency: input.currency.toUpperCase(),
      cardCountry: input.cardCountry?.toUpperCase() ?? null,
      billingCountry: input.billingCountry?.toUpperCase() ?? null,
    });
  }

  static rehydrate(props: PaymentActivityProps): PaymentActivity {
    return new PaymentActivity(props);
  }

  get id(): PaymentActivityId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get kind(): PaymentActivityKind {
    return this.props.kind;
  }

  get outcome(): PaymentActivityOutcome | null {
    return this.props.outcome;
  }

  get occurredAt(): Instant {
    return this.props.occurredAt;
  }

  toProps(): PaymentActivityProps {
    return this.props;
  }
}
