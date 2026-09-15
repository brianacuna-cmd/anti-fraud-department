import { createPollProviderEventsUseCase, toBridgeEnvelope } from '../../src/modules/ingest/application/PollProviderEvents.js';
import { createIngestPolledProviderEventUseCase } from '../../src/modules/ingest/application/ReceiveProviderWebhook.js';
import { mapProviderEnvelope } from '../../src/modules/ingest/infrastructure/adapters/outbound/mapping/mapProviderEnvelope.js';
import type { ProviderIngestEvent } from '../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import type { ProviderIngestEventRepository } from '../../src/modules/ingest/domain/ports/ProviderIngestEventRepository.js';
import type {
  PollCursorRepository,
  PollFeed,
  ProviderEventFeed,
} from '../../src/modules/ingest/domain/ports/ProviderEventFeed.js';
import { createWebhookToScoreOrchestrator } from '../../src/composition/webhookToScoreOrchestrator.js';
import { createCustomerRiskContextEnricher } from '../../src/composition/customerRiskContextEnricher.js';
import { createPaymentCustomerLookup } from '../../src/composition/paymentCustomerLookup.js';
import { createRecordPaymentActivityUseCase } from '../../src/modules/risk-assessment/application/RecordPaymentActivity.js';
import { createGetCustomerPaymentActivityUseCase } from '../../src/modules/risk-assessment/application/GetCustomerPaymentActivity.js';
import { createGetCustomerCaseHistoryUseCase } from '../../src/modules/case-management/application/GetCustomerCaseHistory.js';
import { generatePaymentActivityId } from '../../src/modules/risk-assessment/domain/model/value-objects/PaymentActivityId.js';
import { fromDate } from '../../src/shared/time/Instant.js';
import { InMemoryPaymentActivityRepository } from '../helpers/risk-assessment/InMemoryPaymentActivityRepository.js';
import { FixedClock } from '../helpers/FixedClock.js';
import { oid } from '../support/oid.js';

const ORG = oid('org-1');
const NOW = fromDate(new Date('2026-09-15T12:00:00.000Z'));
const NOW_S = Date.parse(NOW) / 1000;

class InMemoryEvents implements ProviderIngestEventRepository {
  readonly rows: ProviderIngestEvent[] = [];
  async insertUnique(event: ProviderIngestEvent) {
    const exists = this.rows.some((r) => r.provider === event.provider && r.providerEventId === event.providerEventId);
    if (exists) return 'duplicate' as const;
    this.rows.push(event);
    return 'inserted' as const;
  }
  async save(event: ProviderIngestEvent) {
    const i = this.rows.findIndex((r) => r.id === event.id);
    if (i >= 0) this.rows[i] = event;
  }
  async findByOrgProviderEvent() {
    return null;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
}

class InMemoryCursors implements PollCursorRepository {
  readonly values = new Map<string, string>();
  async get(org: string, feed: PollFeed) {
    return this.values.get(`${org}:${feed}`) ?? null;
  }
  async save(org: string, feed: PollFeed, cursor: string) {
    this.values.set(`${org}:${feed}`, cursor);
  }
}

function failedCharge(n: number) {
  return {
    id: `evt_fail_${n}`,
    object: 'event',
    type: 'charge.failed',
    created: NOW_S - 60 * (6 - n),
    account: 'acct_seller',
    data: {
      object: {
        id: `ch_${n}`,
        object: 'charge',
        amount: 5000,
        currency: 'usd',
        status: 'failed',
        payment_intent: 'pi_link',
        failure_code: 'card_declined',
        outcome: { network_decline_code: 'fraudulent', type: 'issuer_declined' },
        payment_method_details: { card: { country: 'US', fingerprint: `fp_${n}` } },
      },
    },
  };
}

const BRIDGE_TRANSFER = {
  id: 'tr_big',
  state: 'payment_processed',
  amount: '12000',
  currency: 'usd',
  on_behalf_of: 'bridge-cust-1',
  created_at: '2026-09-15T11:00:00.000Z',
  updated_at: '2026-09-15T11:30:00.000Z',
  destination: { payment_rail: 'ethereum', currency: 'usdc', to_address: '0xNEW' },
};

function build(feed: ProviderEventFeed) {
  const clock = new FixedClock(NOW);
  const activities = new InMemoryPaymentActivityRepository();
  const events = new InMemoryEvents();
  const cursors = new InMemoryCursors();
  const scored: { provider: string; activity: Record<string, number> | undefined }[] = [];
  const enrich = createCustomerRiskContextEnricher({
    getCustomerPaymentActivity: createGetCustomerPaymentActivityUseCase({ activities }),
    getCustomerCaseHistory: createGetCustomerCaseHistoryUseCase({
      reader: { countByCustomer: async () => ({ previousCases: 0, openCases: 0, fraudConfirmedCases: 0, falsePositiveCases: 0 }) },
    }),
  });
  const composer = createWebhookToScoreOrchestrator({
    events,
    clock,
    recordPaymentActivity: createRecordPaymentActivityUseCase({ activities, clock, generatePaymentActivityId }),
    processRiskScoreToCase: async (input) => {
      const enriched = await enrich(input);
      scored.push({ provider: enriched.provider, activity: enriched.activity });
      return { riskScore: 0, ruleId: 'r', conditionsVersion: 1, opened: false };
    },
  });
  const errors: string[] = [];
  const poll = createPollProviderEventsUseCase({
    feed,
    cursors,
    ingest: createIngestPolledProviderEventUseCase({
      events,
      mapper: { map: mapProviderEnvelope },
      paymentCustomers: createPaymentCustomerLookup(activities),
      composer,
      clock,
    }),
    clock,
    backfillMs: 24 * 3_600_000,
    bridgeCreatedWindowMs: 7 * 24 * 3_600_000,
    onError: (feed) => errors.push(feed),
  });
  return { poll, activities, events, cursors, scored, errors };
}

describe('provider polling, end to end through the webhook pipeline', () => {
  it('ingests fetched Stripe events and Bridge transfers like webhooks, and moves the cursors', async () => {
    const asked: unknown[] = [];
    const feed: ProviderEventFeed = {
      stripeEventsSince: async (since) => {
        asked.push({ stripe: since });
        return { items: [1, 2, 3, 4, 5].map(failedCharge), until: NOW_S - 60, truncated: false };
      },
      bridgeTransfersSince: async (since, createdAfter) => {
        asked.push({ bridge: since, createdAfter });
        return { items: [BRIDGE_TRANSFER], until: BRIDGE_TRANSFER.updated_at, truncated: false };
      },
    };
    const { poll, activities, cursors, scored } = build(feed);

    const result = await poll(ORG);

    expect(result.stripe).toMatchObject({ fetched: 5, processed: 5, error: false });
    expect(result.bridge).toMatchObject({ fetched: 1, processed: 1, error: false });
    // First poll reaches back the backfill window.
    expect(asked).toEqual(
      expect.arrayContaining([
        { stripe: NOW_S - 24 * 3600 },
        { bridge: '2026-09-14T12:00:00.000Z', createdAfter: '2026-09-08T12:00:00.000Z' },
      ]),
    );
    expect(activities.all()).toHaveLength(6);
    const lastStripe = scored.filter((s) => s.provider === 'stripe').at(-1)!.activity!;
    expect(lastStripe).toMatchObject({ failedAttempts10m: 5, linkSuspiciousDeclines: 5, linkDistinctCards: 5 });
    const bridge = scored.find((s) => s.provider === 'bridge')!.activity!;
    expect(bridge).toMatchObject({ transfers24h: 1, currentTransferCents: 1_200_000, newCounterpartyTransferCents: 1_200_000 });
    expect(cursors.values.get(`${ORG}:stripe-events`)).toBe(String(NOW_S - 60));
    expect(cursors.values.get(`${ORG}:bridge-transfers`)).toBe(BRIDGE_TRANSFER.updated_at);
  });

  it('processes an event once even when it is fetched again', async () => {
    const feed: ProviderEventFeed = {
      stripeEventsSince: async () => ({ items: [failedCharge(1)], until: NOW_S, truncated: false }),
      bridgeTransfersSince: async (since) => ({ items: [BRIDGE_TRANSFER], until: since, truncated: false }),
    };
    const { poll, activities } = build(feed);

    await poll(ORG);
    const second = await poll(ORG);

    expect(second.stripe).toMatchObject({ fetched: 1, processed: 0, duplicates: 1 });
    expect(second.bridge).toMatchObject({ duplicates: 1 });
    expect(activities.all()).toHaveLength(2);
  });

  it('keeps each feed independent and does not move a cursor when its feed fails', async () => {
    const feed: ProviderEventFeed = {
      stripeEventsSince: async () => ({ items: [failedCharge(1)], until: NOW_S, truncated: false }),
      bridgeTransfersSince: async () => {
        throw new Error('Bridge down');
      },
    };
    const { poll, cursors, errors } = build(feed);

    const result = await poll(ORG);

    expect(result.stripe.processed).toBe(1);
    expect(result.bridge.error).toBe(true);
    expect(errors).toEqual(['bridge-transfers']);
    expect(cursors.values.has(`${ORG}:bridge-transfers`)).toBe(false);
  });

  it('steps a truncated Stripe cursor back one second so same-second events are not lost', async () => {
    const feed: ProviderEventFeed = {
      stripeEventsSince: async () => ({ items: [failedCharge(1)], until: NOW_S - 100, truncated: true }),
      bridgeTransfersSince: async (since) => ({ items: [], until: since, truncated: false }),
    };
    const { poll, cursors } = build(feed);

    await poll(ORG);

    expect(cursors.values.get(`${ORG}:stripe-events`)).toBe(String(NOW_S - 101));
  });

  it('turns a Bridge transfer into the status webhook of its current state', () => {
    expect(toBridgeEnvelope(BRIDGE_TRANSFER)).toEqual({
      event_id: 'poll:tr_big:payment_processed',
      event_type: 'transfer.updated.status_transitioned',
      event_created_at: BRIDGE_TRANSFER.updated_at,
      event_object: BRIDGE_TRANSFER,
    });
  });
});
