import { toDate, type Instant } from '../../../../shared/time/Instant.js';
import type { PaymentActivityProps } from './aggregates/PaymentActivity.js';

/**
 * Variables the scoring engine gets on top of the event itself, computed by
 * THIS service from what it has recorded — never taken from the provider.
 * That is why they live in their own namespaces (`activity.*`,
 * `customerHistory.*`) and not inside `riskSignals`, which the provider fills:
 * a payload cannot claim "zero failures in 24 h".
 *
 * Closed lists: `factorScoringJdm` allows exactly these paths, and the rule
 * editor offers exactly these. A variable added here must be added there too.
 */
export const ACTIVITY_VARIABLES = [
  /** Payment attempts in the 24 h before the event, the event included. */
  'attempts24h',
  'failedAttempts24h',
  /** Failed / total attempts in 24 h, as an integer percentage (0 with no attempts). */
  'failureRate24h',
  /** Failures classified FRAUD_SUSPECTED or AUTHENTICATION_FAILED: the card-testing pattern. */
  'suspiciousDeclines24h',
  /** Distinct card issuer countries used in 24 h. */
  'distinctCardCountries24h',
  'chargebacks90d',
  'fraudWarnings90d',
  /** Failed attempts of the customer in the 10 minutes before the event: bursts (velocity). */
  'failedAttempts10m',
  /**
   * Failures classified FRAUD_SUSPECTED or AUTHENTICATION_FAILED on the SAME
   * payment link as the event (the Stripe PaymentIntent a Finturu link keeps).
   * 0 when the event carries no link.
   */
  'linkSuspiciousDeclines',
  /** Distinct cards (Stripe card fingerprint) tried on the same payment link: card testing. */
  'linkDistinctCards',
  /**
   * Payment links of the event's merchant with 3+ failed attempts each in the
   * last 30 days: a seller whose links keep failing. 0 without a merchant.
   */
  'merchantLinksWithRepeatedFailures',
  /** Delivered transfers of the customer in 24 h (Bridge). */
  'transfers24h',
  /** Cents moved by delivered transfers in 24 h, whatever the currency. */
  'transferVolume24hCents',
  /** Distinct transfer destinations (wallet or external account) in 7 days. */
  'distinctCounterparties7d',
  /** The event's own amount when it is a transfer, 0 otherwise: "a large transfer". */
  'currentTransferCents',
  /** The event's amount when it is a transfer to a destination the customer never sent to before, 0 otherwise. */
  'newCounterpartyTransferCents',
] as const;

export const CUSTOMER_HISTORY_VARIABLES = [
  /** Every earlier case of the customer, whatever its state. */
  'previousCases',
  /** Earlier cases still being worked. */
  'openCases',
  /** Earlier cases closed with outcome FRAUD_CONFIRMED. */
  'fraudConfirmedCases',
  /** Earlier cases closed with outcome FALSE_POSITIVE. */
  'falsePositiveCases',
  /** Days since the customer's first recorded payment activity (0 when this is the first). */
  'daysSinceFirstActivity',
  'lifetimeAttempts',
  'lifetimeChargebacks',
] as const;

export type ActivityVariable = (typeof ACTIVITY_VARIABLES)[number];
export type CustomerHistoryVariable = (typeof CUSTOMER_HISTORY_VARIABLES)[number];

export type ActivityVariables = Readonly<Record<ActivityVariable, number>>;
export type CustomerHistoryVariables = Readonly<Record<CustomerHistoryVariable, number>>;

/** Case counts come from case-management; they arrive here already counted. */
export interface CustomerCaseCounts {
  readonly previousCases: number;
  readonly openCases: number;
  readonly fraudConfirmedCases: number;
  readonly falsePositiveCases: number;
}

/** Everything the activity store knows about one customer at one instant. */
export interface PaymentActivitySummary {
  readonly attempts24h: number;
  readonly failedAttempts24h: number;
  readonly failedAttempts10m: number;
  readonly suspiciousDeclines24h: number;
  readonly distinctCardCountries24h: number;
  readonly transfers24h: number;
  readonly transferVolume24hCents: number;
  readonly distinctCounterparties7d: number;
  readonly chargebacks90d: number;
  readonly fraudWarnings90d: number;
  readonly lifetimeAttempts: number;
  readonly lifetimeChargebacks: number;
  readonly firstActivityAt: Instant | null;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const WINDOW_10M_MS = 10 * 60_000;
export const WINDOW_24H_MS = DAY_MS;
export const WINDOW_7D_MS = 7 * DAY_MS;
export const WINDOW_30D_MS = 30 * DAY_MS;
export const WINDOW_90D_MS = 90 * DAY_MS;
/** Failed attempts on one link that make it count as a repeatedly failing link. */
export const REPEATED_FAILURES_PER_LINK = 3;

const SUSPICIOUS_DECLINES: ReadonlySet<string> = new Set(['FRAUD_SUSPECTED', 'AUTHENTICATION_FAILED']);

/** Categories the Mongo adapter matches with `$in`, kept next to the in-memory rule. */
export const SUSPICIOUS_DECLINE_CATEGORIES: readonly string[] = [...SUSPICIOUS_DECLINES];

/**
 * Reference implementation of the summary over plain rows. Windows are
 * `(anchor - window, anchor]` on `occurredAt`; rows after the anchor are
 * ignored, so re-scoring an old event does not see its own future.
 *
 * The Mongo adapter computes the same thing with an aggregation; the
 * in-memory fake uses this function, and both are tested against the same
 * expectations.
 */
export function summarizePaymentActivity(
  rows: readonly PaymentActivityProps[],
  anchor: Instant,
): PaymentActivitySummary {
  const anchorMs = toDate(anchor).getTime();
  const past = rows.filter((row) => toDate(row.occurredAt).getTime() <= anchorMs);
  const within = (row: PaymentActivityProps, windowMs: number) =>
    toDate(row.occurredAt).getTime() > anchorMs - windowMs;

  const attempts = past.filter((row) => row.kind === 'ATTEMPT');
  const attempts24h = attempts.filter((row) => within(row, WINDOW_24H_MS));
  const failed24h = attempts24h.filter((row) => row.outcome === 'FAILED');
  const chargebacks = past.filter((row) => row.kind === 'CHARGEBACK');
  const delivered = past.filter((row) => row.kind === 'TRANSFER' && row.outcome === 'SUCCEEDED');
  const delivered24h = delivered.filter((row) => within(row, WINDOW_24H_MS));
  const first = past.reduce<number | null>((min, row) => {
    const ms = toDate(row.occurredAt).getTime();
    return min === null || ms < min ? ms : min;
  }, null);

  return {
    attempts24h: attempts24h.length,
    failedAttempts24h: failed24h.length,
    failedAttempts10m: failed24h.filter((row) => within(row, WINDOW_10M_MS)).length,
    suspiciousDeclines24h: failed24h.filter((row) => SUSPICIOUS_DECLINES.has(row.declineCategory ?? '')).length,
    distinctCardCountries24h: new Set(attempts24h.map((row) => row.cardCountry).filter((c) => c !== null)).size,
    transfers24h: delivered24h.length,
    transferVolume24hCents: delivered24h.reduce((sum, row) => sum + row.amountCents, 0),
    distinctCounterparties7d: new Set(
      past
        .filter((row) => row.kind === 'TRANSFER' && within(row, WINDOW_7D_MS))
        .map((row) => row.counterparty)
        .filter((c) => c !== null),
    ).size,
    chargebacks90d: chargebacks.filter((row) => within(row, WINDOW_90D_MS)).length,
    fraudWarnings90d: past.filter((row) => row.kind === 'FRAUD_WARNING' && within(row, WINDOW_90D_MS)).length,
    lifetimeAttempts: attempts.length,
    lifetimeChargebacks: chargebacks.length,
    firstActivityAt: first === null ? null : (new Date(first).toISOString() as Instant),
  };
}

/**
 * What the event's own payment link and merchant add to the customer view.
 * Scoped to the event, not to the customer: they only mean something while
 * scoring one payment, so panels that show a customer leave them out.
 */
export interface PaymentContextSummary {
  readonly linkSuspiciousDeclines: number;
  readonly linkDistinctCards: number;
  readonly merchantLinksWithRepeatedFailures: number;
  /** Earlier transfers of the customer to the event's destination (strictly before the event). */
  readonly counterpartyPreviousTransfers: number;
}

export const EMPTY_PAYMENT_CONTEXT: PaymentContextSummary = {
  linkSuspiciousDeclines: 0,
  linkDistinctCards: 0,
  merchantLinksWithRepeatedFailures: 0,
  counterpartyPreviousTransfers: 0,
};

export interface PaymentContextKeys {
  /** The payment link the event belongs to (Stripe PaymentIntent). */
  readonly paymentLinkReference: string | null;
  /** The merchant that was paid (Stripe connected account). */
  readonly merchantId: string | null;
  /** Destination of the event when it is a transfer, and every id of its customer. */
  readonly counterparty?: string | null;
  readonly customerIds?: readonly string[];
}

/**
 * Reference implementation of the link and merchant context over plain rows
 * (all of the organization, any customer). Rows after the anchor are ignored.
 *
 * - Link counts cover the link's whole life: a link is short-lived, and card
 *   testing on it is not bounded by a clock window.
 * - The merchant count looks at the last 30 days, grouping failed attempts
 *   by their payment link.
 */
export function summarizePaymentContext(
  rows: readonly PaymentActivityProps[],
  keys: PaymentContextKeys,
  anchor: Instant,
): PaymentContextSummary {
  const anchorMs = toDate(anchor).getTime();
  const failedAttempts = rows.filter(
    (row) => row.kind === 'ATTEMPT' && row.outcome === 'FAILED' && toDate(row.occurredAt).getTime() <= anchorMs,
  );
  const onLink = (row: PaymentActivityProps) =>
    keys.paymentLinkReference !== null && row.relatedReferences.includes(keys.paymentLinkReference);
  const linkAttempts = rows.filter(
    (row) => row.kind === 'ATTEMPT' && onLink(row) && toDate(row.occurredAt).getTime() <= anchorMs,
  );

  const failuresByLink = new Map<string, number>();
  const merchantFailures = failedAttempts.filter(
    (row) =>
      keys.merchantId !== null &&
      row.merchantId === keys.merchantId &&
      toDate(row.occurredAt).getTime() > anchorMs - WINDOW_30D_MS,
  );
  for (const link of merchantFailures.map((row) => row.relatedReferences[0]).filter((l) => l !== undefined)) {
    failuresByLink.set(link, (failuresByLink.get(link) ?? 0) + 1);
  }

  return {
    linkSuspiciousDeclines: failedAttempts.filter(
      (row) => onLink(row) && SUSPICIOUS_DECLINES.has(row.declineCategory ?? ''),
    ).length,
    linkDistinctCards: new Set(linkAttempts.map((row) => row.cardFingerprint).filter((f) => f !== null)).size,
    merchantLinksWithRepeatedFailures: [...failuresByLink.values()].filter((n) => n >= REPEATED_FAILURES_PER_LINK)
      .length,
    counterpartyPreviousTransfers: previousTransfersTo(rows, keys, anchorMs),
  };
}

function previousTransfersTo(rows: readonly PaymentActivityProps[], keys: PaymentContextKeys, anchorMs: number): number {
  const counterparty = keys.counterparty?.toLowerCase() ?? null;
  const customers = new Set(keys.customerIds ?? []);
  if (counterparty === null || customers.size === 0) return 0;
  return rows.filter(
    (row) =>
      row.kind === 'TRANSFER' &&
      row.counterparty === counterparty &&
      customers.has(row.customerId) &&
      toDate(row.occurredAt).getTime() < anchorMs,
  ).length;
}

/** The payment being scored, for the variables about the event itself. */
export interface CurrentPayment {
  readonly activityKind: string | null;
  readonly amountCents: number;
  readonly counterparty: string | null;
}

export function toActivityVariables(
  summary: PaymentActivitySummary,
  context: PaymentContextSummary = EMPTY_PAYMENT_CONTEXT,
  current: CurrentPayment | null = null,
): ActivityVariables {
  const transferCents = current?.activityKind === 'TRANSFER' ? Math.max(0, current.amountCents) : 0;
  return {
    attempts24h: summary.attempts24h,
    failedAttempts24h: summary.failedAttempts24h,
    failureRate24h:
      summary.attempts24h === 0 ? 0 : Math.round((summary.failedAttempts24h / summary.attempts24h) * 100),
    suspiciousDeclines24h: summary.suspiciousDeclines24h,
    distinctCardCountries24h: summary.distinctCardCountries24h,
    chargebacks90d: summary.chargebacks90d,
    fraudWarnings90d: summary.fraudWarnings90d,
    failedAttempts10m: summary.failedAttempts10m,
    linkSuspiciousDeclines: context.linkSuspiciousDeclines,
    linkDistinctCards: context.linkDistinctCards,
    merchantLinksWithRepeatedFailures: context.merchantLinksWithRepeatedFailures,
    transfers24h: summary.transfers24h,
    transferVolume24hCents: summary.transferVolume24hCents,
    distinctCounterparties7d: summary.distinctCounterparties7d,
    currentTransferCents: transferCents,
    newCounterpartyTransferCents:
      current?.counterparty && context.counterpartyPreviousTransfers === 0 ? transferCents : 0,
  };
}

export function toCustomerHistoryVariables(
  summary: PaymentActivitySummary,
  cases: CustomerCaseCounts,
  anchor: Instant,
): CustomerHistoryVariables {
  const days =
    summary.firstActivityAt === null
      ? 0
      : Math.max(0, Math.floor((toDate(anchor).getTime() - toDate(summary.firstActivityAt).getTime()) / DAY_MS));
  return {
    previousCases: cases.previousCases,
    openCases: cases.openCases,
    fraudConfirmedCases: cases.fraudConfirmedCases,
    falsePositiveCases: cases.falsePositiveCases,
    daysSinceFirstActivity: days,
    lifetimeAttempts: summary.lifetimeAttempts,
    lifetimeChargebacks: summary.lifetimeChargebacks,
  };
}
