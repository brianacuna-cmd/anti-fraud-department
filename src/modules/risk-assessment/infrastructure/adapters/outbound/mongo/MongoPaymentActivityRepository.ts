import { ObjectId, type Collection, type Db } from 'mongodb';
import { fromDate, toDate, type Instant } from '../../../../../../shared/time/Instant.js';
import { isDuplicateKeyError } from '../../../../../../shared/persistence/mongo/duplicateKey.js';
import {
  PaymentActivity,
  type PaymentActivityKind,
  type PaymentActivityOutcome,
  type PaymentActivitySource,
} from '../../../../domain/model/aggregates/PaymentActivity.js';
import { createPaymentActivityId } from '../../../../domain/model/value-objects/PaymentActivityId.js';
import {
  SUSPICIOUS_DECLINE_CATEGORIES,
  WINDOW_24H_MS,
  WINDOW_90D_MS,
  type PaymentActivitySummary,
} from '../../../../domain/model/CustomerRiskContext.js';
import type { PaymentActivityRepository } from '../../../../domain/ports/PaymentActivityRepository.js';
import type { MerchantActivitySummary } from '../../../../domain/model/MerchantRisk.js';

export const PAYMENT_ACTIVITIES_COLLECTION = 'payment_activities';

export interface PaymentActivityDocument {
  readonly _id: ObjectId;
  readonly organization_id: ObjectId;
  readonly customer_id: string;
  readonly provider: string;
  readonly provider_event_id: string;
  readonly provider_reference: string | null;
  /** Absent on rows recorded before the field existed. */
  readonly related_references?: readonly string[];
  readonly merchant_id?: string | null;
  readonly provider_event_type: string;
  readonly kind: string;
  readonly outcome: string | null;
  readonly amount_cents: number;
  readonly currency: string;
  readonly decline_category: string | null;
  readonly card_country: string | null;
  readonly billing_country: string | null;
  readonly source: string;
  readonly occurred_at: Date;
  readonly recorded_at: Date;
}

interface SummaryFacets {
  readonly day: readonly { attempts: number; failed: number; suspicious: number; countries: (string | null)[] }[];
  readonly quarter: readonly { chargebacks: number; warnings: number }[];
  readonly lifetime: readonly { attempts: number; chargebacks: number; first: Date | null }[];
}

/**
 * Mongo adapter for the customer payment history. The summary is one
 * `$facet` aggregation over the customer's rows up to the anchor, backed by
 * `payment_activities_org_customer_occurred_idx`. Semantics mirror
 * `summarizePaymentActivity` exactly — both are tested against the same cases.
 */
export class MongoPaymentActivityRepository implements PaymentActivityRepository {
  private readonly collection: Collection<PaymentActivityDocument>;

  constructor(db: Db) {
    this.collection = db.collection<PaymentActivityDocument>(PAYMENT_ACTIVITIES_COLLECTION);
  }

  async record(activity: PaymentActivity): Promise<'inserted' | 'duplicate'> {
    try {
      await this.collection.insertOne(toDocument(activity));
      return 'inserted';
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return 'duplicate';
      }
      throw error;
    }
  }

  async summarize(
    organizationId: string,
    customerIds: readonly string[],
    anchor: Instant,
  ): Promise<PaymentActivitySummary> {
    const anchorDate = toDate(anchor);
    const since24h = new Date(anchorDate.getTime() - WINDOW_24H_MS);
    const since90d = new Date(anchorDate.getTime() - WINDOW_90D_MS);
    const isKind = (kind: string) => ({ $cond: [{ $eq: ['$kind', kind] }, 1, 0] });

    const [facets] = await this.collection
      .aggregate<SummaryFacets>([
        {
          $match: {
            organization_id: new ObjectId(organizationId),
            customer_id: { $in: [...customerIds] },
            occurred_at: { $lte: anchorDate },
          },
        },
        {
          $facet: {
            day: [
              { $match: { kind: 'ATTEMPT', occurred_at: { $gt: since24h } } },
              {
                $group: {
                  _id: null,
                  attempts: { $sum: 1 },
                  failed: { $sum: { $cond: [{ $eq: ['$outcome', 'FAILED'] }, 1, 0] } },
                  suspicious: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ['$outcome', 'FAILED'] },
                            { $in: ['$decline_category', SUSPICIOUS_DECLINE_CATEGORIES] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  countries: { $addToSet: '$card_country' },
                },
              },
            ],
            quarter: [
              { $match: { occurred_at: { $gt: since90d } } },
              { $group: { _id: null, chargebacks: { $sum: isKind('CHARGEBACK') }, warnings: { $sum: isKind('FRAUD_WARNING') } } },
            ],
            lifetime: [
              {
                $group: {
                  _id: null,
                  attempts: { $sum: isKind('ATTEMPT') },
                  chargebacks: { $sum: isKind('CHARGEBACK') },
                  first: { $min: '$occurred_at' },
                },
              },
            ],
          },
        },
      ])
      .toArray();

    const day = facets?.day[0];
    const quarter = facets?.quarter[0];
    const lifetime = facets?.lifetime[0];
    return {
      attempts24h: day?.attempts ?? 0,
      failedAttempts24h: day?.failed ?? 0,
      suspiciousDeclines24h: day?.suspicious ?? 0,
      distinctCardCountries24h: (day?.countries ?? []).filter((c) => c !== null).length,
      chargebacks90d: quarter?.chargebacks ?? 0,
      fraudWarnings90d: quarter?.warnings ?? 0,
      lifetimeAttempts: lifetime?.attempts ?? 0,
      lifetimeChargebacks: lifetime?.chargebacks ?? 0,
      firstActivityAt: lifetime?.first ? fromDate(lifetime.first) : null,
    };
  }

  async listRecent(
    organizationId: string,
    customerIds: readonly string[],
    limit: number,
  ): Promise<readonly PaymentActivity[]> {
    const documents = await this.collection
      .find({ organization_id: new ObjectId(organizationId), customer_id: { $in: [...customerIds] } })
      .sort({ occurred_at: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return documents.map(toDomain);
  }

  async summarizeMerchant(
    organizationId: string,
    merchantIds: readonly string[],
    anchor: Instant,
  ): Promise<MerchantActivitySummary> {
    const anchorDate = toDate(anchor);
    const since90d = new Date(anchorDate.getTime() - WINDOW_90D_MS);
    const failed = { $and: [{ $eq: ['$kind', 'ATTEMPT'] }, { $eq: ['$outcome', 'FAILED'] }] };
    const [row] = await this.collection
      .aggregate<MerchantActivitySummary & { customers: string[] }>([
        {
          $match: {
            organization_id: new ObjectId(organizationId),
            merchant_id: { $in: [...merchantIds] },
            occurred_at: { $gt: since90d, $lte: anchorDate },
          },
        },
        {
          $group: {
            _id: null,
            attempts90d: { $sum: { $cond: [{ $eq: ['$kind', 'ATTEMPT'] }, 1, 0] } },
            failed90d: { $sum: { $cond: [failed, 1, 0] } },
            suspiciousDeclines90d: {
              $sum: { $cond: [{ $and: [failed, { $in: ['$decline_category', SUSPICIOUS_DECLINE_CATEGORIES] }] }, 1, 0] },
            },
            chargebacks90d: { $sum: { $cond: [{ $eq: ['$kind', 'CHARGEBACK'] }, 1, 0] } },
            fraudWarnings90d: { $sum: { $cond: [{ $eq: ['$kind', 'FRAUD_WARNING'] }, 1, 0] } },
            customers: { $addToSet: '$customer_id' },
          },
        },
      ])
      .toArray();
    return {
      attempts90d: row?.attempts90d ?? 0,
      succeeded90d: (row?.attempts90d ?? 0) - (row?.failed90d ?? 0),
      failed90d: row?.failed90d ?? 0,
      suspiciousDeclines90d: row?.suspiciousDeclines90d ?? 0,
      chargebacks90d: row?.chargebacks90d ?? 0,
      fraudWarnings90d: row?.fraudWarnings90d ?? 0,
      distinctCustomers90d: row?.customers.length ?? 0,
    };
  }

  async findByReferences(organizationId: string, references: readonly string[]): Promise<readonly PaymentActivity[]> {
    if (references.length === 0) {
      return [];
    }
    const refs = [...references];
    const documents = await this.collection
      .find({
        organization_id: new ObjectId(organizationId),
        $or: [{ provider_reference: { $in: refs } }, { related_references: { $in: refs } }],
      })
      .toArray();
    return documents.map(toDomain);
  }

  async findCustomerByProviderReference(
    organizationId: string,
    provider: string,
    providerReference: string,
  ): Promise<string | null> {
    const document = await this.collection.findOne(
      { organization_id: new ObjectId(organizationId), provider, provider_reference: providerReference },
      { projection: { customer_id: 1 }, sort: { occurred_at: 1 } },
    );
    return document?.customer_id ?? null;
  }
}

function toDocument(activity: PaymentActivity): PaymentActivityDocument {
  const p = activity.toProps();
  return {
    _id: new ObjectId(p.id),
    organization_id: new ObjectId(p.organizationId),
    customer_id: p.customerId,
    provider: p.provider,
    provider_event_id: p.providerEventId,
    provider_reference: p.providerReference,
    related_references: p.relatedReferences,
    merchant_id: p.merchantId,
    provider_event_type: p.providerEventType,
    kind: p.kind,
    outcome: p.outcome,
    amount_cents: p.amountCents,
    currency: p.currency,
    decline_category: p.declineCategory,
    card_country: p.cardCountry,
    billing_country: p.billingCountry,
    source: p.source,
    occurred_at: toDate(p.occurredAt),
    recorded_at: toDate(p.recordedAt),
  };
}

function toDomain(document: PaymentActivityDocument): PaymentActivity {
  return PaymentActivity.rehydrate({
    id: createPaymentActivityId(document._id.toString()),
    organizationId: document.organization_id.toString(),
    customerId: document.customer_id,
    provider: document.provider,
    providerEventId: document.provider_event_id,
    providerReference: document.provider_reference,
    relatedReferences: document.related_references ?? [],
    merchantId: document.merchant_id ?? null,
    providerEventType: document.provider_event_type,
    kind: document.kind as PaymentActivityKind,
    outcome: document.outcome as PaymentActivityOutcome | null,
    amountCents: document.amount_cents,
    currency: document.currency,
    declineCategory: document.decline_category,
    cardCountry: document.card_country,
    billingCountry: document.billing_country,
    source: document.source as PaymentActivitySource,
    occurredAt: fromDate(document.occurred_at),
    recordedAt: fromDate(document.recorded_at),
  });
}
