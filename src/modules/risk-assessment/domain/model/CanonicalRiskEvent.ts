import type { Instant } from '../../../../shared/time/Instant.js';
import { invariantViolation } from '../errors/RiskAssessmentError.js';
import { ACTIVITY_VARIABLES, CUSTOMER_HISTORY_VARIABLES } from './CustomerRiskContext.js';

/**
 * CamelCase scoring input. Domain/HTTP MUST be camelCase; snake_case keys
 * are rejected. `rawPayload` is optional and must be omitted from engine
 * context later (use case, not this type).
 */
export interface CanonicalRiskEvent {
  readonly provider: string;
  readonly providerEventType: string;
  readonly caseCustomerId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly riskSignals: Readonly<Record<string, unknown>>;
  readonly createdAt: Instant;
  readonly eventId?: string;
  readonly providerEventId?: string;
  readonly rail?: string;
  readonly rawPayload?: Readonly<Record<string, unknown>>;
  readonly subjectIdentity?: SubjectIdentity;
  /** The payment link the event belongs to (Stripe PaymentIntent). Keys `activity.link*`. */
  readonly paymentLinkReference?: string;
  /** The merchant that was paid (Stripe connected account). Keys `activity.merchant*`. */
  readonly merchantId?: string;
  /** What the payment is in the history (ATTEMPT, TRANSFER…): keys `activity.currentTransferCents`. */
  readonly activityKind?: string;
  /** Destination of a transfer: keys `activity.newCounterpartyTransferCents`. */
  readonly counterparty?: string;
  /**
   * Accumulated activity of the customer (`ACTIVITY_VARIABLES`), filled by the
   * composition root from recorded history right before scoring. Anything a
   * caller sends here is overwritten on the production paths; only the
   * simulator keeps what it is given, so a rule can be tried on made-up values.
   */
  readonly activity?: Readonly<Record<string, number>>;
  /** Earlier cases and lifetime figures of the customer (`CUSTOMER_HISTORY_VARIABLES`). */
  readonly customerHistory?: Readonly<Record<string, number>>;
}

export interface SubjectIdentity {
  readonly name?: string;
  readonly document?: string;
  readonly walletAddress?: string;
  readonly entryType?: string;
}

export function createCanonicalRiskEvent(input: Readonly<Record<string, unknown>>): CanonicalRiskEvent {
  assertNoSnakeCaseKeys(input);
  const eventId = pickOptionalString(input.eventId);
  const providerEventId = pickOptionalString(input.providerEventId);
  const rail = pickOptionalString(input.rail);
  const paymentLinkReference = pickOptionalString(input.paymentLinkReference);
  const merchantId = pickOptionalString(input.merchantId);
  const activityKind = pickOptionalString(input.activityKind);
  const counterparty = pickOptionalString(input.counterparty);
  const rawPayload = isRecord(input.rawPayload) ? input.rawPayload : undefined;
  const subjectIdentity = isRecord(input.subjectIdentity) ? pickSubjectIdentity(input.subjectIdentity) : undefined;
  const activity = pickNumberMap('activity', input.activity, ACTIVITY_VARIABLES);
  const customerHistory = pickNumberMap('customerHistory', input.customerHistory, CUSTOMER_HISTORY_VARIABLES);
  return {
    provider: asNonEmptyString('provider', input.provider),
    providerEventType: asNonEmptyString('providerEventType', input.providerEventType),
    caseCustomerId: asNonEmptyString('caseCustomerId', input.caseCustomerId),
    amountCents: asNumber('amountCents', input.amountCents),
    currency: asNonEmptyString('currency', input.currency),
    riskSignals: asRecord('riskSignals', input.riskSignals),
    createdAt: input.createdAt as Instant,
    ...(eventId !== undefined ? { eventId } : {}),
    ...(providerEventId !== undefined ? { providerEventId } : {}),
    ...(rail !== undefined ? { rail } : {}),
    ...(paymentLinkReference !== undefined ? { paymentLinkReference } : {}),
    ...(merchantId !== undefined ? { merchantId } : {}),
    ...(activityKind !== undefined ? { activityKind } : {}),
    ...(counterparty !== undefined ? { counterparty } : {}),
    ...(rawPayload !== undefined ? { rawPayload } : {}),
    ...(subjectIdentity !== undefined ? { subjectIdentity } : {}),
    ...(activity !== undefined ? { activity } : {}),
    ...(customerHistory !== undefined ? { customerHistory } : {}),
  };
}

/** Only the known variables, only finite numbers: an unknown key is an error, not silently kept. */
function pickNumberMap(
  field: string,
  value: unknown,
  allowed: readonly string[],
): Readonly<Record<string, number>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw invariantViolation(`CanonicalRiskEvent ${field} must be an object`, { field });
  }
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey !== undefined) {
    throw invariantViolation(`CanonicalRiskEvent ${field}.${unknownKey} is not a known variable`, { field, key: unknownKey });
  }
  const notNumber = Object.entries(value).find(([, v]) => typeof v !== 'number' || !Number.isFinite(v));
  if (notNumber !== undefined) {
    throw invariantViolation(`CanonicalRiskEvent ${field}.${notNumber[0]} must be a finite number`, { field, key: notNumber[0] });
  }
  return value as Readonly<Record<string, number>>;
}

function pickSubjectIdentity(input: Readonly<Record<string, unknown>>): SubjectIdentity | undefined {
  const name = pickOptionalString(input.name);
  const document = pickOptionalString(input.document);
  const walletAddress = pickOptionalString(input.walletAddress);
  const entryType = pickOptionalString(input.entryType);
  if (name === undefined && document === undefined && walletAddress === undefined && entryType === undefined) {
    return undefined;
  }
  return {
    ...(name !== undefined ? { name } : {}),
    ...(document !== undefined ? { document } : {}),
    ...(walletAddress !== undefined ? { walletAddress } : {}),
    ...(entryType !== undefined ? { entryType } : {}),
  };
}

function assertNoSnakeCaseKeys(input: Readonly<Record<string, unknown>>): void {
  const snakeKey = Object.keys(input).find((key) => key.includes('_'));
  if (snakeKey !== undefined) {
    throw invariantViolation('CanonicalRiskEvent keys must be camelCase', { key: snakeKey });
  }
}

function asNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invariantViolation(`CanonicalRiskEvent ${field} must be a non-empty string`, { field, value });
  }
  return value;
}

function asNumber(field: string, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw invariantViolation(`CanonicalRiskEvent ${field} must be a number`, { field, value });
  }
  return value;
}

function asRecord(field: string, value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw invariantViolation(`CanonicalRiskEvent ${field} must be an object`, { field, value });
  }
  return value;
}

function pickOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
