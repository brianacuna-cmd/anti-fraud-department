import { createIngestedPaymentEvent } from '../../../../domain/model/IngestedPaymentEvent.js';
import type { EnvelopeMapResult } from './EnvelopeMapResult.js';
import { instantFromIso } from './instantFromIso.js';
import { isRecord } from './isRecord.js';
import { inferSubjectEntryType, readOptionalStringPath } from './subjectIdentityPaths.js';

/**
 * SPIKE (RF-2/D-3, Slice 2b): exact Bridge JSON paths are UNVERIFIED against
 * live payloads — confirm before relying on them in production reporting.
 * Assumed: event_object.customer_name, event_object.customer_document_id,
 * and event_object.wallet_address (Bridge is a crypto/stablecoin rail, so a
 * counterparty wallet address is plausible on card_transaction/transfer
 * objects).
 */

const MVP_TYPES = new Set([
  'card_transaction.created',
  'card_transaction.updated',
  'card_transaction.updated.status_transitioned',
  'transfer.created',
  'transfer.updated',
]);

export function mapBridgeEnvelope(payload: unknown): EnvelopeMapResult {
  if (!isRecord(payload)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const type = typeof payload.event_type === 'string' ? payload.event_type : '';
  if (!MVP_TYPES.has(type)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const object = isRecord(payload.event_object) ? payload.event_object : {};
  const amountCents = parseTwoDecimalAmountCents(object.amount);
  if (amountCents === null) {
    return { status: 'failed', reason: 'unparsable_amount' };
  }

  const customerId = firstNonEmptyString(object.customer_id, object.on_behalf_of);
  if (customerId === null) {
    return { status: 'failed', reason: 'missing_customer' };
  }

  const eventId = typeof payload.event_id === 'string' ? payload.event_id : '';
  const currency = typeof object.currency === 'string' ? object.currency.toUpperCase() : '';
  const riskSignals: Record<string, unknown> = {};
  if (typeof object.status === 'string') {
    riskSignals.status = object.status;
  }

  const nombre = readOptionalStringPath(object, ['customer_name']);
  const documento = readOptionalStringPath(object, ['customer_document_id']);
  const walletAddress = readOptionalStringPath(object, ['wallet_address']);
  const entryType = inferSubjectEntryType(nombre, documento, walletAddress);

  return {
    status: 'mapped',
    event: createIngestedPaymentEvent({
      provider: 'bridge',
      providerEventType: type,
      caseCustomerId: customerId,
      amountCents,
      currency,
      riskSignals,
      createdAt: instantFromIso(payload.event_created_at),
      eventId,
      providerEventId: eventId,
      rawPayload: payload,
      subjectIdentity: { nombre, documento, walletAddress, entryType },
    }),
  };
}

function parseTwoDecimalAmountCents(amount: unknown): number | null {
  if (typeof amount !== 'string' || !/^-?\d+\.\d{2}$/.test(amount)) {
    return null;
  }
  return Math.round(Number(amount) * 100);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

