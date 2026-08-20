import type { Instant } from '../../../../shared/time/Instant.js';
import { invariantViolation } from '../errors/IngestError.js';

/**
 * CamelCase ingest DTO. Domain MUST be camelCase; snake_case keys are
 * rejected. Must not import CanonicalRiskEvent (eslint domain↔domain).
 */
export interface IngestedPaymentEvent {
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
}

export function createIngestedPaymentEvent(input: Readonly<Record<string, unknown>>): IngestedPaymentEvent {
  assertNoSnakeCaseKeys(input);
  const eventId = pickOptionalString(input.eventId);
  const providerEventId = pickOptionalString(input.providerEventId);
  const rail = pickOptionalString(input.rail);
  const rawPayload = isRecord(input.rawPayload) ? input.rawPayload : undefined;
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
    ...(rawPayload !== undefined ? { rawPayload } : {}),
  };
}

function assertNoSnakeCaseKeys(input: Readonly<Record<string, unknown>>): void {
  const snakeKey = Object.keys(input).find((key) => key.includes('_'));
  if (snakeKey !== undefined) {
    throw invariantViolation('IngestedPaymentEvent keys must be camelCase', { key: snakeKey });
  }
}

function asNonEmptyString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invariantViolation(`IngestedPaymentEvent ${field} must be a non-empty string`, { field, value });
  }
  return value;
}

function asNumber(field: string, value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw invariantViolation(`IngestedPaymentEvent ${field} must be a number`, { field, value });
  }
  return value;
}

function asRecord(field: string, value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw invariantViolation(`IngestedPaymentEvent ${field} must be an object`, { field, value });
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
