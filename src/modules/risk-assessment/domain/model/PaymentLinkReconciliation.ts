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

/**
 * A charge as the provider reports it right now (Stripe, queried live through
 * api-business). Amounts in cents.
 */
export interface ProviderChargeRecord {
  readonly chargeId: string;
  /** What the payment link stores: the Stripe PaymentIntent. */
  readonly paymentIntentId: string | null;
  readonly amountCents: number;
  /** Stripe `status === 'succeeded'`. */
  readonly succeeded: boolean;
  /** A dispute was opened on the charge. */
  readonly disputed: boolean;
}

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
  | 'NO_PROVIDER_REFERENCE'
  /**
   * The provider could not be asked: not a Stripe link, the merchant has no
   * Stripe Connect account, or Stripe did not answer. Reported apart so it is
   * never mistaken for "paid without provider payment".
   */
  | 'PROVIDER_NOT_QUERIED';

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
 * Crosses Finturu payment links with the charges the provider reports when
 * asked (Stripe, live). Matching is by the PaymentIntent stored on the link
 * against each charge's PaymentIntent, or its charge id.
 *
 * `queriedMerchants` are the merchants whose charges were actually fetched:
 * a link of any other merchant, or of a provider that is not queried, is
 * PROVIDER_NOT_QUERIED instead of looking unpaid.
 */
export function reconcilePaymentLinks(
  links: readonly PaymentLinkRecord[],
  charges: readonly ProviderChargeRecord[],
  queriedMerchants: ReadonlySet<number>,
): ReconciliationReport {
  const byReference = indexByReference(charges);
  const items = links.map((link) =>
    reconcileOne(link, link.providerPaymentId ? (byReference.get(link.providerPaymentId) ?? []) : [], queriedMerchants),
  );

  const totals = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<ReconciliationStatus, number>;
  for (const item of items) totals[item.status] += 1;

  return {
    totals,
    discrepancies: items.filter((item) => !QUIET.has(item.status)),
    linksChecked: links.length,
  };
}

/** Stripe is the provider queried live. */
export function isQueriedProvider(provider: string | null): boolean {
  return (provider ?? '').toLowerCase() === 'stripe';
}

const STATUSES: readonly ReconciliationStatus[] = [
  'MATCHED',
  'UNPAID',
  'PAID_WITHOUT_PROVIDER_PAYMENT',
  'PROVIDER_PAID_LINK_UNPAID',
  'AMOUNT_MISMATCH',
  'CHARGEBACK',
  'NO_PROVIDER_REFERENCE',
  'PROVIDER_NOT_QUERIED',
];

function indexByReference(charges: readonly ProviderChargeRecord[]): Map<string, ProviderChargeRecord[]> {
  const index = new Map<string, ProviderChargeRecord[]>();
  const pairs = charges.flatMap((charge) =>
    [charge.paymentIntentId, charge.chargeId]
      .filter((reference): reference is string => !!reference)
      .map((reference) => [reference, charge] as const),
  );
  for (const [reference, charge] of pairs) {
    const bucket = index.get(reference) ?? [];
    index.set(reference, bucket.includes(charge) ? bucket : [...bucket, charge]);
  }
  return index;
}

function reconcileOne(
  link: PaymentLinkRecord,
  rows: readonly ProviderChargeRecord[],
  queriedMerchants: ReadonlySet<number>,
): ReconciliationItem {
  const linkPaid = link.isPaid || PAID_LINK_STATES.includes(link.state ?? '');
  const succeeded = rows.filter((row) => row.succeeded);
  const providerAmountCents = succeeded.length === 0 ? null : succeeded.reduce((sum, row) => sum + row.amountCents, 0);
  const chargebacks = rows.filter((row) => row.disputed).length;
  const queried =
    isQueriedProvider(link.provider) && link.merchantUserId !== null && queriedMerchants.has(link.merchantUserId);
  const expectedAmountCents = Math.round((link.amount + link.shippingAmount) * 100);

  return {
    linkId: link.id,
    merchantUserId: link.merchantUserId,
    status: statusOf({ link, linkPaid, providerAmountCents, expectedAmountCents, chargebacks, queried }),
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
  queried: boolean;
}): ReconciliationStatus {
  if (facts.chargebacks > 0) return 'CHARGEBACK';
  const providerPaid = facts.providerAmountCents !== null;
  if (facts.linkPaid && facts.link.providerPaymentId === null) return 'NO_PROVIDER_REFERENCE';
  if (!facts.queried) return facts.linkPaid ? 'PROVIDER_NOT_QUERIED' : 'UNPAID';
  if (facts.linkPaid && !providerPaid) return 'PAID_WITHOUT_PROVIDER_PAYMENT';
  if (!facts.linkPaid && providerPaid) return 'PROVIDER_PAID_LINK_UNPAID';
  if (!facts.linkPaid) return 'UNPAID';
  return Math.abs((facts.providerAmountCents ?? 0) - facts.expectedAmountCents) > AMOUNT_TOLERANCE_CENTS
    ? 'AMOUNT_MISMATCH'
    : 'MATCHED';
}
