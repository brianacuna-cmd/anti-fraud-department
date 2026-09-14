import type { PaymentActivityProps } from './aggregates/PaymentActivity.js';

/** A Finturu payment link, as the reconciliation needs it. Amounts in USD. */
export interface PaymentLinkRecord {
  readonly id: number;
  readonly merchantUserId: number | null;
  readonly amount: number;
  readonly shippingAmount: number;
  readonly state: string | null;
  readonly isPaid: boolean;
  readonly provider: string | null;
  /** Stripe PaymentIntent or Coinflow payment id stored on the link. */
  readonly providerPaymentId: string | null;
  readonly refundAmount: number | null;
  readonly createdAt: string | null;
}

/** Same list api-business uses for its monthly cap. */
export const PAID_LINK_STATES: readonly string[] = ['PAID', 'DISBURSED', 'PROCESS', 'PARTIAL_REFUND', 'REFUND_IN_PROGRESS'];

export type ReconciliationStatus =
  /** Link and provider agree. */
  | 'MATCHED'
  /** Not paid in Finturu and nothing paid at the provider: consistent, nothing to review. */
  | 'UNPAID'
  /** Finturu says paid, the provider never reported a successful payment. The one that matters most. */
  | 'PAID_WITHOUT_PROVIDER_PAYMENT'
  /** The provider charged it, Finturu still shows the link unpaid. */
  | 'PROVIDER_PAID_LINK_UNPAID'
  /** Both say paid, for different amounts. */
  | 'AMOUNT_MISMATCH'
  /** The payment was disputed. */
  | 'CHARGEBACK'
  /** Paid in Finturu with no provider id stored: it cannot be checked at all. */
  | 'NO_PROVIDER_REFERENCE';

export interface ReconciliationItem {
  readonly linkId: number;
  readonly merchantUserId: number | null;
  readonly status: ReconciliationStatus;
  readonly linkState: string | null;
  readonly linkPaid: boolean;
  readonly provider: string | null;
  readonly providerPaymentId: string | null;
  /** What the link should have charged: amount + shipping, in cents. */
  readonly expectedAmountCents: number;
  /** What the provider reported as successfully charged, in cents; `null` when nothing was. */
  readonly providerAmountCents: number | null;
  readonly chargebacks: number;
  readonly linkCreatedAt: string | null;
}

export interface ReconciliationReport {
  readonly totals: Readonly<Record<ReconciliationStatus, number>>;
  /** Only the rows that need a look (everything but MATCHED and UNPAID). */
  readonly discrepancies: readonly ReconciliationItem[];
  readonly linksChecked: number;
}

/** One cent of rounding either way is not a discrepancy. */
const AMOUNT_TOLERANCE_CENTS = 1;

const QUIET: ReadonlySet<ReconciliationStatus> = new Set(['MATCHED', 'UNPAID']);

/**
 * Crosses Finturu payment links with the payment history the providers
 * reported (webhooks and CSV imports). Matching is by the provider payment id
 * stored on the link against each activity's reference or related references
 * (Stripe: PaymentIntent; Coinflow: payment id).
 *
 * A link can only be proven paid by activity this service recorded: links paid
 * before the history started show as PAID_WITHOUT_PROVIDER_PAYMENT until the
 * provider export for that period is imported. That is expected, and the
 * report says so rather than hiding those links.
 */
export function reconcilePaymentLinks(
  links: readonly PaymentLinkRecord[],
  activities: readonly PaymentActivityProps[],
): ReconciliationReport {
  const byReference = indexByReference(activities);
  const items = links.map((link) => reconcileOne(link, link.providerPaymentId ? (byReference.get(link.providerPaymentId) ?? []) : []));

  const totals = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<ReconciliationStatus, number>;
  for (const item of items) totals[item.status] += 1;

  return {
    totals,
    discrepancies: items.filter((item) => !QUIET.has(item.status)),
    linksChecked: links.length,
  };
}

const STATUSES: readonly ReconciliationStatus[] = [
  'MATCHED',
  'UNPAID',
  'PAID_WITHOUT_PROVIDER_PAYMENT',
  'PROVIDER_PAID_LINK_UNPAID',
  'AMOUNT_MISMATCH',
  'CHARGEBACK',
  'NO_PROVIDER_REFERENCE',
];

function indexByReference(activities: readonly PaymentActivityProps[]): Map<string, PaymentActivityProps[]> {
  const index = new Map<string, PaymentActivityProps[]>();
  const pairs = activities.flatMap((row) =>
    [row.providerReference, ...row.relatedReferences]
      .filter((reference): reference is string => !!reference)
      .map((reference) => [reference, row] as const),
  );
  for (const [reference, row] of pairs) {
    const bucket = index.get(reference) ?? [];
    index.set(reference, bucket.includes(row) ? bucket : [...bucket, row]);
  }
  return index;
}

function reconcileOne(link: PaymentLinkRecord, rows: readonly PaymentActivityProps[]): ReconciliationItem {
  const linkPaid = link.isPaid || PAID_LINK_STATES.includes(link.state ?? '');
  const succeeded = rows.filter((row) => row.kind === 'ATTEMPT' && row.outcome === 'SUCCEEDED');
  const providerAmountCents = succeeded.length === 0 ? null : succeeded.reduce((sum, row) => sum + row.amountCents, 0);
  const chargebacks = rows.filter((row) => row.kind === 'CHARGEBACK').length;
  const expectedAmountCents = Math.round((link.amount + link.shippingAmount) * 100);

  return {
    linkId: link.id,
    merchantUserId: link.merchantUserId,
    status: statusOf({ link, linkPaid, providerAmountCents, expectedAmountCents, chargebacks }),
    linkState: link.state,
    linkPaid,
    provider: link.provider,
    providerPaymentId: link.providerPaymentId,
    expectedAmountCents,
    providerAmountCents,
    chargebacks,
    linkCreatedAt: link.createdAt,
  };
}

function statusOf(facts: {
  link: PaymentLinkRecord;
  linkPaid: boolean;
  providerAmountCents: number | null;
  expectedAmountCents: number;
  chargebacks: number;
}): ReconciliationStatus {
  if (facts.chargebacks > 0) return 'CHARGEBACK';
  const providerPaid = facts.providerAmountCents !== null;
  if (facts.linkPaid && facts.link.providerPaymentId === null) return 'NO_PROVIDER_REFERENCE';
  if (facts.linkPaid && !providerPaid) return 'PAID_WITHOUT_PROVIDER_PAYMENT';
  if (!facts.linkPaid && providerPaid) return 'PROVIDER_PAID_LINK_UNPAID';
  if (!facts.linkPaid) return 'UNPAID';
  return Math.abs((facts.providerAmountCents ?? 0) - facts.expectedAmountCents) > AMOUNT_TOLERANCE_CENTS
    ? 'AMOUNT_MISMATCH'
    : 'MATCHED';
}
