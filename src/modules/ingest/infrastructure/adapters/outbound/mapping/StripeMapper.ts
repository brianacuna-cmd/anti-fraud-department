import { fromDate } from '../../../../../../shared/time/Instant.js';
import { classifyStripeDecline } from '../../../../../../shared/payments/stripeDeclineClassification.js';
import {
  createIngestedPaymentEvent,
  type PaymentActivityDescriptor,
} from '../../../../domain/model/IngestedPaymentEvent.js';
import type { EnvelopeMapHints, EnvelopeMapResult } from './EnvelopeMapResult.js';
import { isRecord } from './isRecord.js';
import { inferSubjectEntryType, readOptionalStringPath } from './subjectIdentityPaths.js';

/**
 * SPIKE (RF-2/D-3, Slice 2b): exact Stripe JSON paths are UNVERIFIED against
 * live payloads — confirm before relying on them in production reporting.
 * Assumed: charge.billing_details.name for the cardholder name, and an
 * optional charge.metadata.documento for a merchant-supplied document id
 * (Stripe does not natively carry a national ID). Stripe is card-rails only,
 * so no wallet address is ever extracted here.
 */

const CHARGE_TYPES = new Set(['charge.succeeded', 'charge.failed', 'charge.updated']);
const EFW_CREATED = 'radar.early_fraud_warning.created';
const DISPUTE_CREATED = 'charge.dispute.created';
const UPDATED = 'charge.updated';

export function mapStripeEnvelope(payload: unknown, hints: EnvelopeMapHints = {}): EnvelopeMapResult {
  if (!isRecord(payload)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : {};
  const object = isRecord(data.object) ? data.object : {};

  if (type === EFW_CREATED) {
    return mapEarlyFraudWarning(payload, object, hints);
  }
  if (type === DISPUTE_CREATED) {
    return mapDispute(payload, object, hints);
  }

  if (!CHARGE_TYPES.has(type)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const outcome = isRecord(object.outcome) ? object.outcome : null;
  if (type === UPDATED && outcome === null) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  return mapCharge(payload, type, object, outcome, hints);
}

function mapCharge(
  payload: Record<string, unknown>,
  type: string,
  charge: Record<string, unknown>,
  outcome: Record<string, unknown> | null,
  hints: EnvelopeMapHints,
): EnvelopeMapResult {
  const riskSignals: Record<string, unknown> = {};
  if (outcome !== null) {
    if (typeof outcome.risk_score === 'number') {
      riskSignals.stripeRiskScore = outcome.risk_score;
    }
    if (typeof outcome.risk_level === 'string') {
      riskSignals.stripeRiskLevel = outcome.risk_level;
    }
  }
  Object.assign(riskSignals, declineSignals(type, charge, outcome), countrySignals(charge));

  return mappedStripe(payload, type, charge, riskSignals, hints, withMerchant(payload, chargeActivity(type, charge)));
}

/**
 * A charge is counted once, when it settles as succeeded or failed.
 * `charge.updated` repeats a charge already counted, so it adds nothing to
 * the payment history (it is still scored: Radar may have changed its view).
 */
function chargeActivity(type: string, charge: Record<string, unknown>): PaymentActivityDescriptor | undefined {
  if (type === UPDATED) {
    return undefined;
  }
  const reference = readOptionalStringPath(charge, ['id']);
  const paymentIntent = readOptionalStringPath(charge, ['payment_intent']);
  const cardFingerprint = readOptionalStringPath(charge, ['payment_method_details', 'card', 'fingerprint']);
  return {
    kind: 'ATTEMPT',
    outcome: type === 'charge.failed' ? 'FAILED' : 'SUCCEEDED',
    ...(reference !== undefined ? { providerReference: reference } : {}),
    ...(paymentIntent !== undefined ? { relatedReferences: [paymentIntent] } : {}),
    ...(cardFingerprint !== undefined ? { cardFingerprint } : {}),
  };
}

/**
 * Connect webhooks carry the connected account at the envelope's top level
 * (`account`): that is the merchant that was paid.
 */
function withMerchant(
  payload: Record<string, unknown>,
  activity: PaymentActivityDescriptor | undefined,
): PaymentActivityDescriptor | undefined {
  const merchantId = readOptionalStringPath(payload, ['account']);
  return activity === undefined || merchantId === undefined ? activity : { ...activity, merchantId };
}

/**
 * Only a FAILED charge is classified. A succeeded charge placed in review
 * also carries `outcome.reason` (e.g. `elevated_risk_level`), and reading it
 * as a decline would count a paid charge as a failure.
 */
function declineSignals(
  type: string,
  charge: Record<string, unknown>,
  outcome: Record<string, unknown> | null,
): Record<string, unknown> {
  if (type !== 'charge.failed' && charge.status !== 'failed') {
    return {};
  }
  const classification = classifyStripeDecline([
    readOptionalStringPath(outcome, ['network_decline_code']),
    readOptionalStringPath(outcome, ['reason']),
    readOptionalStringPath(charge, ['failure_code']),
    readOptionalStringPath(outcome, ['type']),
  ]);
  return classification === null
    ? {}
    : { declineCode: classification.code, declineCategory: classification.category };
}

/**
 * Card issuer country (BIN) and the billing country the buyer typed. Kept
 * apart on purpose: a mismatch between them is a signal in itself.
 */
function countrySignals(charge: Record<string, unknown>): Record<string, unknown> {
  const cardCountry = readOptionalStringPath(charge, ['payment_method_details', 'card', 'country']);
  const billingCountry = readOptionalStringPath(charge, ['billing_details', 'address', 'country']);
  return {
    ...(cardCountry !== undefined ? { cardCountry: cardCountry.toUpperCase() } : {}),
    ...(billingCountry !== undefined ? { billingCountry: billingCountry.toUpperCase() } : {}),
  };
}

function mapEarlyFraudWarning(
  payload: Record<string, unknown>,
  efw: Record<string, unknown>,
  hints: EnvelopeMapHints,
): EnvelopeMapResult {
  const charge = isRecord(efw.charge) ? efw.charge : {};
  const riskSignals: Record<string, unknown> = {};
  if (typeof efw.fraud_type === 'string') {
    riskSignals.fraudType = efw.fraud_type;
  }
  if (typeof efw.actionable === 'boolean') {
    riskSignals.actionable = efw.actionable;
  }
  const reference = referencedChargeId(efw.charge);
  return mappedStripe(payload, EFW_CREATED, charge, riskSignals, hints, withMerchant(payload, {
    kind: 'FRAUD_WARNING',
    ...(reference !== undefined ? { providerReference: reference } : {}),
  }));
}

/**
 * A dispute is a chargeback on an earlier charge. Its own object carries the
 * disputed amount and currency, but NOT the customer: `charge` is just an id
 * in webhooks. `mappedStripe` then reports `missing_customer` with that id as
 * `providerReference`, and the ingest use case retries with the customer it
 * recorded for that charge.
 */
function mapDispute(
  payload: Record<string, unknown>,
  dispute: Record<string, unknown>,
  hints: EnvelopeMapHints,
): EnvelopeMapResult {
  const riskSignals: Record<string, unknown> = {};
  if (typeof dispute.reason === 'string') {
    riskSignals.disputeReason = dispute.reason;
  }
  if (typeof dispute.status === 'string') {
    riskSignals.disputeStatus = dispute.status;
  }
  const charge = isRecord(dispute.charge) ? dispute.charge : {};
  const reference = referencedChargeId(dispute.charge);
  const moneySource = { ...dispute, customer: charge.customer ?? dispute.customer };
  const paymentIntent = readOptionalStringPath(dispute, ['payment_intent']);
  return mappedStripe(payload, DISPUTE_CREATED, moneySource, riskSignals, hints, withMerchant(payload, {
    kind: 'CHARGEBACK',
    ...(reference !== undefined ? { providerReference: reference } : {}),
    ...(paymentIntent !== undefined ? { relatedReferences: [paymentIntent] } : {}),
  }));
}

function referencedChargeId(charge: unknown): string | undefined {
  if (typeof charge === 'string' && charge.trim().length > 0) {
    return charge;
  }
  return readOptionalStringPath(charge, ['id']);
}

function mappedStripe(
  payload: Record<string, unknown>,
  type: string,
  moneySource: Record<string, unknown>,
  riskSignals: Record<string, unknown>,
  hints: EnvelopeMapHints,
  paymentActivity: PaymentActivityDescriptor | undefined,
): EnvelopeMapResult {
  const customerId =
    typeof moneySource.customer === 'string' && moneySource.customer.trim().length > 0
      ? moneySource.customer
      : (hints.customerId ?? null);
  if (customerId === null) {
    const providerReference = paymentActivity?.providerReference;
    return {
      status: 'failed',
      reason: 'missing_customer',
      ...(providerReference !== undefined && type !== 'charge.succeeded' && type !== 'charge.failed'
        ? { providerReference }
        : {}),
    };
  }

  if (typeof moneySource.amount !== 'number' || Number.isNaN(moneySource.amount)) {
    return { status: 'failed', reason: 'unparsable_amount' };
  }

  const eventId = typeof payload.id === 'string' ? payload.id : '';
  const currency =
    typeof moneySource.currency === 'string' ? moneySource.currency.toUpperCase() : '';

  const name = readOptionalStringPath(moneySource, ['billing_details', 'name']);
  // Merchants supply this Stripe metadata key; it is an external contract, not our identifier.
  const document = readOptionalStringPath(moneySource, ['metadata', 'documento']);
  const entryType = inferSubjectEntryType(name, document, undefined);

  return {
    status: 'mapped',
    event: createIngestedPaymentEvent({
      provider: 'stripe',
      providerEventType: type,
      caseCustomerId: customerId,
      amountCents: moneySource.amount,
      currency,
      riskSignals,
      createdAt: fromUnixSeconds(payload.created),
      eventId,
      providerEventId: eventId,
      rawPayload: payload,
      subjectIdentity: { name, document, entryType },
      ...(paymentActivity !== undefined ? { paymentActivity } : {}),
    }),
  };
}

function fromUnixSeconds(value: unknown) {
  const seconds = typeof value === 'number' ? value : 0;
  return fromDate(new Date(seconds * 1000));
}
