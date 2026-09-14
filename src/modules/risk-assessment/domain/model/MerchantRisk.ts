import { toDate, type Instant } from '../../../../shared/time/Instant.js';
import type { PaymentActivityProps } from './aggregates/PaymentActivity.js';
import { SUSPICIOUS_DECLINE_CATEGORIES, WINDOW_90D_MS } from './CustomerRiskContext.js';

/** Payment link figures of a merchant, as Finturu reports them. */
export interface MerchantLinkFigures {
  readonly total: number;
  readonly paid: number;
  readonly refused: number;
  readonly expired: number;
  readonly refunded: number;
  readonly paidAmount: number;
  readonly refundedAmount: number;
}

/** What the payment history says about the payments a merchant received, last 90 days. */
export interface MerchantActivitySummary {
  readonly attempts90d: number;
  readonly succeeded90d: number;
  readonly failed90d: number;
  readonly suspiciousDeclines90d: number;
  readonly chargebacks90d: number;
  readonly fraudWarnings90d: number;
  readonly distinctCustomers90d: number;
}

export interface MerchantCaseFigures {
  readonly openCases: number;
  readonly fraudConfirmedCases: number;
}

export interface MerchantRiskInput {
  readonly links: MerchantLinkFigures;
  readonly activity: MerchantActivitySummary;
  readonly cases: MerchantCaseFigures;
  /** When the merchant signed up in Finturu; `null` when unknown. */
  readonly merchantSince: Instant | null;
  readonly now: Instant;
}

export type MerchantRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MerchantRiskFactor {
  readonly code: string;
  readonly points: number;
  /** Plain sentence with the figure that triggered it: it is what the analyst reads. */
  readonly reason: string;
}

export interface MerchantRiskAssessment {
  readonly score: number;
  readonly level: MerchantRiskLevel;
  readonly factors: readonly MerchantRiskFactor[];
}

/**
 * Card network monitoring programs start around 0.9% disputes over settled
 * transactions (Visa VDMP). A merchant above it is in trouble with the network
 * regardless of what our rules say.
 */
export const CHARGEBACK_RATIO_THRESHOLD = 0.009;

const DAY_MS = 24 * 3_600_000;

interface FactorRule {
  readonly code: string;
  readonly points: number;
  readonly when: (input: MerchantRiskInput, derived: Derived) => boolean;
  readonly reason: (input: MerchantRiskInput, derived: Derived) => string;
}

interface Derived {
  readonly chargebackRatio: number;
  readonly failureRate: number;
  readonly refusedRate: number;
  readonly refundRate: number;
  readonly ageDays: number | null;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

/**
 * Transparent, additive merchant risk: every factor has fixed points and says
 * why it fired, so a score can be explained line by line and two readings of
 * the same data always agree. Deliberately NOT a configurable rule: merchant
 * risk is a triage aid for the analyst, not something that opens cases.
 *
 * Rates only count with enough volume behind them (minimum sample per rule),
 * so a merchant with two links and one refusal is not "50% refused".
 */
const RULES: readonly FactorRule[] = [
  {
    code: 'CHARGEBACK_RATIO',
    points: 35,
    when: (i, d) => i.activity.succeeded90d >= 20 && d.chargebackRatio >= CHARGEBACK_RATIO_THRESHOLD,
    reason: (i, d) => `Ratio de chargebacks ${pct(d.chargebackRatio)} (${i.activity.chargebacks90d} sobre ${i.activity.succeeded90d} cobros en 90 días): supera el umbral de las redes`,
  },
  {
    code: 'CHARGEBACKS',
    points: 20,
    when: (i, d) => i.activity.chargebacks90d > 0 && !(i.activity.succeeded90d >= 20 && d.chargebackRatio >= CHARGEBACK_RATIO_THRESHOLD),
    reason: (i) => `${i.activity.chargebacks90d} chargeback(s) en 90 días`,
  },
  {
    code: 'FRAUD_WARNINGS',
    points: 15,
    when: (i) => i.activity.fraudWarnings90d > 0,
    reason: (i) => `${i.activity.fraudWarnings90d} aviso(s) de fraude del proveedor en 90 días`,
  },
  {
    code: 'CARD_TESTING',
    points: 20,
    when: (i) => i.activity.suspiciousDeclines90d >= 10,
    reason: (i) => `${i.activity.suspiciousDeclines90d} rechazos por sospecha de fraude o verificación fallida en 90 días`,
  },
  {
    code: 'FAILURE_RATE',
    points: 10,
    when: (i, d) => i.activity.attempts90d >= 20 && d.failureRate >= 0.4,
    reason: (i, d) => `Tasa de fallo ${pct(d.failureRate)} sobre ${i.activity.attempts90d} intentos en 90 días`,
  },
  {
    code: 'REFUSED_LINKS',
    points: 10,
    when: (i, d) => i.links.total >= 10 && d.refusedRate >= 0.3,
    reason: (i, d) => `${pct(d.refusedRate)} de sus enlaces de pago rechazados (${i.links.refused} de ${i.links.total})`,
  },
  {
    code: 'REFUNDS',
    points: 10,
    when: (i, d) => i.links.paid >= 10 && d.refundRate >= 0.1,
    reason: (i, d) => `${pct(d.refundRate)} de los enlaces cobrados con reembolso (${i.links.refunded} de ${i.links.paid})`,
  },
  {
    code: 'FRAUD_CONFIRMED_CASES',
    points: 30,
    when: (i) => i.cases.fraudConfirmedCases > 0,
    reason: (i) => `${i.cases.fraudConfirmedCases} expediente(s) cerrados con fraude confirmado`,
  },
  {
    code: 'OPEN_CASES',
    points: 10,
    when: (i) => i.cases.openCases > 0,
    reason: (i) => `${i.cases.openCases} expediente(s) abiertos`,
  },
  {
    code: 'NEW_HIGH_VOLUME',
    points: 10,
    when: (i, d) => d.ageDays !== null && d.ageDays < 30 && i.links.paidAmount >= 10_000,
    reason: (i, d) => `Comercio de ${d.ageDays} días con ${i.links.paidAmount.toFixed(2)} USD ya cobrados`,
  },
];

export function assessMerchantRisk(input: MerchantRiskInput): MerchantRiskAssessment {
  const derived = derive(input);
  const factors = RULES.filter((rule) => rule.when(input, derived)).map((rule) => ({
    code: rule.code,
    points: rule.points,
    reason: rule.reason(input, derived),
  }));
  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  return { score, level: levelOf(score), factors };
}

function derive(input: MerchantRiskInput): Derived {
  const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);
  return {
    chargebackRatio: ratio(input.activity.chargebacks90d, input.activity.succeeded90d),
    failureRate: ratio(input.activity.failed90d, input.activity.attempts90d),
    refusedRate: ratio(input.links.refused, input.links.total),
    refundRate: ratio(input.links.refunded, input.links.paid),
    ageDays:
      input.merchantSince === null
        ? null
        : Math.max(0, Math.floor((toDate(input.now).getTime() - toDate(input.merchantSince).getTime()) / DAY_MS)),
  };
}

export function levelOf(score: number): MerchantRiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

/**
 * Reference implementation of the merchant summary over plain rows; the Mongo
 * adapter computes the same with an aggregation (tested against the same case).
 */
export function summarizeMerchantActivity(
  rows: readonly PaymentActivityProps[],
  anchor: Instant,
): MerchantActivitySummary {
  const anchorMs = toDate(anchor).getTime();
  const window = rows.filter((row) => {
    const ms = toDate(row.occurredAt).getTime();
    return ms <= anchorMs && ms > anchorMs - WINDOW_90D_MS;
  });
  const attempts = window.filter((row) => row.kind === 'ATTEMPT');
  const failed = attempts.filter((row) => row.outcome === 'FAILED');
  return {
    attempts90d: attempts.length,
    succeeded90d: attempts.length - failed.length,
    failed90d: failed.length,
    suspiciousDeclines90d: failed.filter((row) => SUSPICIOUS_DECLINE_CATEGORIES.includes(row.declineCategory ?? '')).length,
    chargebacks90d: window.filter((row) => row.kind === 'CHARGEBACK').length,
    fraudWarnings90d: window.filter((row) => row.kind === 'FRAUD_WARNING').length,
    distinctCustomers90d: new Set(window.map((row) => row.customerId)).size,
  };
}
