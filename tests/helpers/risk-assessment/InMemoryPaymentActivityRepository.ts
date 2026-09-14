import type { Instant } from '../../../src/shared/time/Instant.js';
import type { PaymentActivity } from '../../../src/modules/risk-assessment/domain/model/aggregates/PaymentActivity.js';
import {
  summarizePaymentActivity,
  type PaymentActivitySummary,
} from '../../../src/modules/risk-assessment/domain/model/CustomerRiskContext.js';
import type { PaymentActivityRepository } from '../../../src/modules/risk-assessment/domain/ports/PaymentActivityRepository.js';
import {
  summarizeMerchantActivity,
  type MerchantActivitySummary,
} from '../../../src/modules/risk-assessment/domain/model/MerchantRisk.js';

/** In-memory fake: the summary is the domain's reference `summarizePaymentActivity`. */
export class InMemoryPaymentActivityRepository implements PaymentActivityRepository {
  private readonly rows: PaymentActivity[] = [];

  all(): readonly PaymentActivity[] {
    return this.rows;
  }

  async record(activity: PaymentActivity): Promise<'inserted' | 'duplicate'> {
    const p = activity.toProps();
    const exists = this.rows.some((row) => {
      const r = row.toProps();
      return r.organizationId === p.organizationId && r.provider === p.provider && r.providerEventId === p.providerEventId;
    });
    if (exists) {
      return 'duplicate';
    }
    this.rows.push(activity);
    return 'inserted';
  }

  async summarize(
    organizationId: string,
    customerIds: readonly string[],
    anchor: Instant,
  ): Promise<PaymentActivitySummary> {
    return summarizePaymentActivity(this.of(organizationId, customerIds).map((row) => row.toProps()), anchor);
  }

  async listRecent(organizationId: string, customerIds: readonly string[], limit: number): Promise<readonly PaymentActivity[]> {
    return [...this.of(organizationId, customerIds)]
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
      .slice(0, limit);
  }

  async summarizeMerchant(
    organizationId: string,
    merchantIds: readonly string[],
    anchor: Instant,
  ): Promise<MerchantActivitySummary> {
    const rows = this.rows
      .map((row) => row.toProps())
      .filter((p) => p.organizationId === organizationId && p.merchantId !== null && merchantIds.includes(p.merchantId));
    return summarizeMerchantActivity(rows, anchor);
  }

  async findByReferences(organizationId: string, references: readonly string[]): Promise<readonly PaymentActivity[]> {
    return this.rows.filter((row) => {
      const p = row.toProps();
      return (
        p.organizationId === organizationId &&
        ((p.providerReference !== null && references.includes(p.providerReference)) ||
          p.relatedReferences.some((r) => references.includes(r)))
      );
    });
  }

  async findCustomerByProviderReference(
    organizationId: string,
    provider: string,
    providerReference: string,
  ): Promise<string | null> {
    const row = this.rows.find((r) => {
      const p = r.toProps();
      return p.organizationId === organizationId && p.provider === provider && p.providerReference === providerReference;
    });
    return row?.customerId ?? null;
  }

  private of(organizationId: string, customerIds: readonly string[]): PaymentActivity[] {
    return this.rows.filter((row) => row.organizationId === organizationId && customerIds.includes(row.customerId));
  }
}
