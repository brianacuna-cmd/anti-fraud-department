import { createIngestedPaymentEvent } from '../../../../domain/model/IngestedPaymentEvent.js';
import type { EnvelopeMapResult } from './EnvelopeMapResult.js';
import { instantFromIso } from './instantFromIso.js';
import { isRecord } from './isRecord.js';
import { inferSubjectEntryType, readOptionalStringPath } from './subjectIdentityPaths.js';

/**
 * SPIKE (RF-2/D-3, Slice 2b): exact Coinflow JSON paths are UNVERIFIED
 * against live payloads — confirm before relying on them in production
 * reporting. Assumed: data.customerName, data.documentId, and
 * data.walletAddress (Coinflow supports crypto on/off-ramp, so a wallet
 * address is plausible alongside customerId on the data object).
 */

const MVP_TYPES = new Set([
  'Card Payment Suspected Fraud',
  'Payment Pending Review',
  'Card Payment Declined',
  'Card Payment Authorized',
]);

export function mapCoinflowEnvelope(payload: unknown): EnvelopeMapResult {
  if (!isRecord(payload)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const eventType = typeof payload.eventType === 'string' ? payload.eventType : '';
  if (!MVP_TYPES.has(eventType)) {
    return { status: 'ignored', reason: 'unknown_event_type' };
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const customerId = typeof data.customerId === 'string' ? data.customerId : '';
  if (customerId.trim().length === 0) {
    return { status: 'failed', reason: 'missing_customer' };
  }

  const subtotal = isRecord(data.subtotal) ? data.subtotal : {};
  if (typeof subtotal.cents !== 'number' || Number.isNaN(subtotal.cents)) {
    return { status: 'failed', reason: 'unparsable_amount' };
  }

  const created = typeof payload.created === 'string' ? payload.created : String(payload.created ?? '');
  const dataId = typeof data.id === 'string' ? data.id : '';
  const providerEventId = `${eventType}:${dataId}:${created}`;
  const currency = typeof subtotal.currency === 'string' ? subtotal.currency.toUpperCase() : '';

  const riskSignals: Record<string, unknown> = { eventType };
  if (typeof payload.category === 'string') {
    riskSignals.category = payload.category;
  }
  if (typeof data.declineCode === 'string') {
    riskSignals.declineCode = data.declineCode;
  }

  const name = readOptionalStringPath(data, ['customerName']);
  const document = readOptionalStringPath(data, ['documentId']);
  const walletAddress = readOptionalStringPath(data, ['walletAddress']);
  const entryType = inferSubjectEntryType(name, document, walletAddress);

  return {
    status: 'mapped',
    event: createIngestedPaymentEvent({
      provider: 'coinflow',
      providerEventType: eventType,
      caseCustomerId: customerId,
      amountCents: subtotal.cents,
      currency,
      riskSignals,
      createdAt: instantFromIso(created),
      providerEventId,
      rawPayload: payload,
      subjectIdentity: { name, document, walletAddress, entryType },
    }),
  };
}

