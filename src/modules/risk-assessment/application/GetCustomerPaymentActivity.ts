import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { PaymentActivity } from '../domain/model/aggregates/PaymentActivity.js';
import {
  EMPTY_PAYMENT_CONTEXT,
  type PaymentActivitySummary,
  type PaymentContextSummary,
} from '../domain/model/CustomerRiskContext.js';
import type { PaymentActivityRepository } from '../domain/ports/PaymentActivityRepository.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetCustomerPaymentActivityInput {
  readonly auth: AuthContext;
  /** Every id the customer is known by; blanks and duplicates are dropped. */
  readonly customerIds: readonly string[];
  /** Windows end here: the event's time when scoring, "now" for the case file. */
  readonly anchor: Instant;
  /** How many recent rows to return; 0 when only the summary is needed (scoring). */
  readonly recentLimit: number;
  /** When scoring one payment: its link and merchant, for the `activity.link*` / `activity.merchant*` counts. */
  readonly paymentLinkReference?: string | null;
  readonly merchantId?: string | null;
}

export interface GetCustomerPaymentActivityResult {
  readonly summary: PaymentActivitySummary;
  readonly recent: readonly PaymentActivity[];
  /** Zeros unless a link or merchant was given. */
  readonly context: PaymentContextSummary;
}

export interface GetCustomerPaymentActivityDeps {
  readonly activities: PaymentActivityRepository;
}

const MAX_RECENT = 100;

/** Tenant-scoped read of a customer's accumulated payment activity. */
export function createGetCustomerPaymentActivityUseCase(deps: GetCustomerPaymentActivityDeps) {
  return async function getCustomerPaymentActivity(
    input: GetCustomerPaymentActivityInput,
  ): Promise<GetCustomerPaymentActivityResult> {
    const organizationId = requireTenantContext(input.auth);
    const limit = Math.max(0, Math.min(MAX_RECENT, Math.trunc(input.recentLimit)));
    const customerIds = [...new Set(input.customerIds.map((id) => id.trim()).filter((id) => id.length > 0))];
    const keys = { paymentLinkReference: input.paymentLinkReference ?? null, merchantId: input.merchantId ?? null };
    const [summary, recent, context] = await Promise.all([
      deps.activities.summarize(organizationId, customerIds, input.anchor),
      limit === 0 ? Promise.resolve([]) : deps.activities.listRecent(organizationId, customerIds, limit),
      keys.paymentLinkReference === null && keys.merchantId === null
        ? Promise.resolve(EMPTY_PAYMENT_CONTEXT)
        : deps.activities.summarizePaymentContext(organizationId, keys, input.anchor),
    ]);
    return { summary, recent, context };
  };
}
