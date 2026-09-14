import {
  classifyStripeDecline,
  type DeclineClassification,
} from '../../../../../../../shared/payments/stripeDeclineClassification.js';

/**
 * Adds `decline: { code, category }` to the charges api-business returns for
 * a connected account, so the Stripe view labels them with the SAME table the
 * ingest rules use. api-business only sends the raw codes.
 *
 * Only failed charges are classified (see `StripeMapper.declineSignals` for
 * why a succeeded charge in review must not be). Everything else in the
 * payload passes through untouched: this is still a proxy.
 */
export function withChargeDeclines(page: Record<string, unknown> | null): Record<string, unknown> | null {
  if (page === null || !Array.isArray(page.items)) {
    return page;
  }
  return { ...page, items: page.items.map((item) => withDecline(item)) };
}

/** Same enrichment for the single-charge detail (`{ charge, ... }`). */
export function withChargeDetailDecline(detail: Record<string, unknown> | null): Record<string, unknown> | null {
  if (detail === null || !isRecord(detail.charge)) {
    return detail;
  }
  return { ...detail, charge: withDecline(detail.charge) };
}

function withDecline(item: unknown): unknown {
  if (!isRecord(item)) {
    return item;
  }
  return { ...item, decline: classify(item) };
}

function classify(charge: Record<string, unknown>): DeclineClassification | null {
  if (charge.status !== 'failed') {
    return null;
  }
  const risk = isRecord(charge.risk) ? charge.risk : {};
  return classifyStripeDecline([
    asString(charge.networkDeclineCode),
    asString(risk.reason),
    asString(charge.failureCode),
    asString(risk.type),
  ]);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
