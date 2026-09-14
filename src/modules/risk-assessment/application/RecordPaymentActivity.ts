import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import { PaymentActivity } from '../domain/model/aggregates/PaymentActivity.js';
import type { PaymentActivityId } from '../domain/model/value-objects/PaymentActivityId.js';
import type { PaymentActivityRepository } from '../domain/ports/PaymentActivityRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface RecordPaymentActivityInput {
  readonly auth: AuthContext;
  readonly customerId: string;
  readonly provider: string;
  readonly providerEventId: string;
  readonly providerReference?: string | null;
  readonly relatedReferences?: readonly string[];
  readonly merchantId?: string | null;
  readonly providerEventType: string;
  readonly kind: string;
  readonly outcome?: string | null;
  readonly amountCents: number;
  readonly currency: string;
  readonly declineCategory?: string | null;
  readonly cardCountry?: string | null;
  readonly billingCountry?: string | null;
  readonly source: string;
  readonly occurredAt: Instant;
}

export interface RecordPaymentActivityDeps {
  readonly activities: PaymentActivityRepository;
  readonly clock: Clock;
  readonly generatePaymentActivityId: () => PaymentActivityId;
}

/**
 * Appends one payment event to the customer's history. Called by the system
 * (webhook composition, CSV import), so it only needs a tenant, not a role.
 *
 * Not audited: it is a copy of what the provider already reported, and the
 * ingest row (or the import job) is the trail of that delivery. Auditing it
 * would write one audit row per payment.
 */
export function createRecordPaymentActivityUseCase(deps: RecordPaymentActivityDeps) {
  return async function recordPaymentActivity(
    input: RecordPaymentActivityInput,
  ): Promise<'inserted' | 'duplicate'> {
    const organizationId = requireTenantContext(input.auth);
    const activity = PaymentActivity.create({
      id: deps.generatePaymentActivityId(),
      organizationId,
      customerId: input.customerId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      providerReference: input.providerReference ?? null,
      relatedReferences: input.relatedReferences ?? [],
      merchantId: input.merchantId ?? null,
      providerEventType: input.providerEventType,
      kind: input.kind,
      outcome: input.outcome ?? null,
      amountCents: input.amountCents,
      currency: input.currency,
      declineCategory: input.declineCategory ?? null,
      cardCountry: input.cardCountry ?? null,
      billingCountry: input.billingCountry ?? null,
      source: input.source,
      occurredAt: input.occurredAt,
      recordedAt: deps.clock.now(),
    });
    return deps.activities.record(activity);
  };
}
