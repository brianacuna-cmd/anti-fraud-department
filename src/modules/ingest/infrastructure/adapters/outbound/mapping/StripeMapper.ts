import { fromDate } from '../../../../../../shared/time/Instant.js';
import { createIngestedPaymentEvent } from '../../../../domain/model/IngestedPaymentEvent.js';
import type { EnvelopeMapResult } from './EnvelopeMapResult.js';
import { isRecord } from './isRecord.js';

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

  return mappedStripe(payload, type, charge, riskSignals);
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
    }),
  };
}

function fromUnixSeconds(value: unknown) {
  const seconds = typeof value === 'number' ? value : 0;
  return fromDate(new Date(seconds * 1000));
}
