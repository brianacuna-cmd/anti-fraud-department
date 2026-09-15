import type { Clock } from '../../../shared/time/Clock.js';
import { toDate } from '../../../shared/time/Instant.js';
import type { PollCursorRepository, PollFeed, ProviderEventFeed } from '../domain/ports/ProviderEventFeed.js';
import type {
  IngestPolledProviderEventInput,
  ReceiveProviderWebhookResult,
} from './ReceiveProviderWebhook.js';

export interface PollProviderEventsDeps {
  readonly feed: ProviderEventFeed;
  readonly cursors: PollCursorRepository;
  readonly ingest: (input: IngestPolledProviderEventInput) => Promise<ReceiveProviderWebhookResult>;
  readonly clock: Clock;
  /** How far back the FIRST poll of a feed reaches, with no cursor yet. */
  readonly backfillMs: number;
  /** Bridge transfers created before now minus this are not walked (their later state changes are missed). */
  readonly bridgeCreatedWindowMs: number;
  readonly onError?: (feed: PollFeed, error: unknown) => void;
}

export interface FeedPollResult {
  readonly fetched: number;
  readonly processed: number;
  readonly duplicates: number;
  readonly ignored: number;
  readonly failed: number;
  /** The feed could not be read, or an event could not be ingested: the cursor did not move. */
  readonly error: boolean;
}

export interface PollProviderEventsResult {
  readonly stripe: FeedPollResult;
  readonly bridge: FeedPollResult;
}

const EMPTY: FeedPollResult = { fetched: 0, processed: 0, duplicates: 0, ignored: 0, failed: 0, error: false };

/**
 * Fetches what Stripe and Bridge would have delivered by webhook since the
 * last poll and ingests it exactly like a webhook (`IngestPolledProviderEvent`):
 * payment history, variables, rules, case. For environments the providers
 * cannot reach, and to recover missed deliveries.
 *
 * Each feed keeps its own cursor and fails on its own: Bridge being down does
 * not hold Stripe back. A cursor only moves when every fetched event was
 * ingested, so an error means the next poll fetches the same window again;
 * what did get in the first time comes back as DUPLICATE and does nothing.
 *
 * A Bridge transfer has no event id: it becomes a `transfer.updated.status_transitioned`
 * envelope identified by transfer id AND state, so each state counts once.
 */
export function createPollProviderEventsUseCase(deps: PollProviderEventsDeps) {
  const onError = deps.onError ?? ((feed, error) => console.error(`[provider-poll] ${feed}`, error));

  return async function pollProviderEvents(organizationId: string): Promise<PollProviderEventsResult> {
    const nowMs = toDate(deps.clock.now()).getTime();
    const [stripe, bridge] = await Promise.all([
      pollStripe(organizationId, nowMs).catch((error: unknown) => failure('stripe-events', error)),
      pollBridge(organizationId, nowMs).catch((error: unknown) => failure('bridge-transfers', error)),
    ]);
    return { stripe, bridge };
  };

  function failure(feed: PollFeed, error: unknown): FeedPollResult {
    onError(feed, error);
    return { ...EMPTY, error: true };
  }

  async function pollStripe(organizationId: string, nowMs: number): Promise<FeedPollResult> {
    const cursor = await deps.cursors.get(organizationId, 'stripe-events');
    const since = cursor === null ? Math.floor((nowMs - deps.backfillMs) / 1000) : Number(cursor);
    const page = await deps.feed.stripeEventsSince(since);
    const result = await ingestAll(organizationId, 'stripe', page.items);
    if (!result.error) {
      // Truncated: events of the same second may remain, so step back one; they return as duplicates.
      const next = page.truncated && page.until > since ? page.until - 1 : page.until;
      await deps.cursors.save(organizationId, 'stripe-events', String(next));
    }
    return result;
  }

  async function pollBridge(organizationId: string, nowMs: number): Promise<FeedPollResult> {
    const cursor = await deps.cursors.get(organizationId, 'bridge-transfers');
    const since = cursor ?? new Date(nowMs - deps.backfillMs).toISOString();
    const createdAfter = new Date(nowMs - deps.bridgeCreatedWindowMs).toISOString();
    const page = await deps.feed.bridgeTransfersSince(since, createdAfter);
    const result = await ingestAll(organizationId, 'bridge', page.items.map(toBridgeEnvelope));
    if (!result.error) {
      await deps.cursors.save(organizationId, 'bridge-transfers', page.until);
    }
    return result;
  }

  async function ingestAll(
    organizationId: string,
    provider: string,
    payloads: readonly Record<string, unknown>[],
  ): Promise<FeedPollResult> {
    const counts = { fetched: payloads.length, processed: 0, duplicates: 0, ignored: 0, failed: 0, error: false };
    for (const payload of payloads) {
      try {
        const { status } = await deps.ingest({ organizationId, provider, payload });
        if (status === 'PROCESSED') counts.processed += 1;
        else if (status === 'DUPLICATE') counts.duplicates += 1;
        else if (status === 'IGNORED') counts.ignored += 1;
        else counts.failed += 1;
      } catch (error) {
        onError(provider === 'stripe' ? 'stripe-events' : 'bridge-transfers', error);
        counts.error = true;
      }
    }
    return counts;
  }
}

/** A Bridge transfer as the webhook that announces its current state. */
export function toBridgeEnvelope(transfer: Record<string, unknown>): Record<string, unknown> {
  const id = typeof transfer.id === 'string' ? transfer.id : 'unknown';
  const state = typeof transfer.state === 'string' ? transfer.state : 'unknown';
  return {
    event_id: `poll:${id}:${state}`,
    event_type: 'transfer.updated.status_transitioned',
    event_created_at: transfer.updated_at ?? transfer.created_at,
    event_object: transfer,
  };
}
