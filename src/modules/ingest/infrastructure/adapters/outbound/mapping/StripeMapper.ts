import { fromDate } from '../../../../../../shared/time/Instant.js';
import { classifyStripeDecline } from '../../../../../../shared/payments/stripeDeclineClassification.js';
import { createIngestedPaymentEvent } from '../../../../domain/model/IngestedPaymentEvent.js';
import type { EnvelopeMapResult } from './EnvelopeMapResult.js';
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
const UPDATED = 'charge.updated';

export function mapStripeEnvelope(payload: unknown): EnvelopeMapResult {
  if (!isRecord(payload)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const type = typeof payload.type === 'string' ? payload.type : '';
  const data = isRecord(payload.data) ? payload.data : {};
  const object = isRecord(data.object) ? data.object : {};

  if (type === EFW_CREATED) {
    return mapEarlyFraudWarning(payload, object);
  }

  if (!CHARGE_TYPES.has(type)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const outcome = isRecord(object.outcome) ? object.outcome : null;
  if (type === UPDATED && outcome === null) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  return mapCharge(payload, type, object, outcome);
}

function mapCharge(
  payload: Record<string, unknown>,
  type: string,
  charge: Record<string, unknown>,
  outcome: Record<string, unknown> | null,
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

  return mappedStripe(payload, type, charge, riskSignals);
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
): EnvelopeMapResult {
  const charge = isRecord(efw.charge) ? efw.charge : {};
  const riskSignals: Record<string, unknown> = {};
  if (typeof efw.fraud_type === 'string') {
    riskSignals.fraudType = efw.fraud_type;
  }
  if (typeof efw.actionable === 'boolean') {
    riskSignals.actionable = efw.actionable;
  }
  return mappedStripe(payload, EFW_CREATED, charge, riskSignals);
}

function mappedStripe(
  payload: Record<string, unknown>,
  type: string,
  moneySource: Record<string, unknown>,
  riskSignals: Record<string, unknown>,
): EnvelopeMapResult {
  const customerId =
    typeof moneySource.customer === 'string' && moneySource.customer.trim().length > 0
      ? moneySource.customer
      : null;
  if (customerId === null) {
    return { status: 'failed', reason: 'missing_customer' };
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
    }),
  };
}

function fromUnixSeconds(value: unknown) {
  const seconds = typeof value === 'number' ? value : 0;
  return fromDate(new Date(seconds * 1000));
}
