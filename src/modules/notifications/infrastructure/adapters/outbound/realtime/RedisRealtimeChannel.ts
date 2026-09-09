import Redis from 'ioredis';

/** Shared Redis pub/sub channel name (design §3c, locked). */
export const REALTIME_CHANNEL = 'realtime:notifications';

/**
 * JSON schema published/received on {@link REALTIME_CHANNEL} (design §3c) —
 * mirrors `NotificationRealtimeInput` but with plain-string ids, since the
 * value crosses a JSON boundary and value-object branding does not survive
 * `JSON.stringify`/`JSON.parse`.
 */
export interface RealtimeMessage {
  readonly organizationId: string;
  readonly userId: string;
  readonly alertType: string;
  readonly context: Record<string, unknown>;
}

/**
 * The subset of `WebSocketGateway` this channel needs to re-deliver an
 * incoming pub/sub message to locally-connected sockets. Kept as a narrow
 * structural interface (not importing `WebSocketGateway` itself) to avoid
 * coupling this outbound adapter to the inbound adapter's full surface.
 */
export interface RealtimeDeliverer {
  deliverTo(organizationId: string, userId: string, payload: unknown): void;
}

export interface RedisRealtimeChannelDeps {
  readonly redisUrl: string;
  readonly deliverer: RealtimeDeliverer;
  /**
   * Reports background failures that have no promise to reject into:
   * connection-level errors on either the `pub` or `sub` client, and
   * malformed/unparseable messages received on the subscription. Fail-safe
   * (design §6): NEVER thrown, always swallowed here and reported via this
   * hook so a Redis outage cannot crash the instance.
   */
  readonly onError?: (error: unknown) => void;
  /**
   * Test seam: overrides how each of the two required connections (`pub`,
   * `sub` — a subscriber connection cannot issue other commands, ADR-4) is
   * constructed. Defaults to real `ioredis` with `lazyConnect` and a capped
   * retry policy (design §6) so a down Redis fails fast instead of
   * buffering forever.
   */
  readonly createClient?: (url: string) => Redis;
}

function defaultClientFactory(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: (times: number) => Math.min(times * 200, 2000),
  });
}

/**
 * Owns the two `ioredis` connections (design ADR-4) backing realtime
 * fan-out: `pub` publishes outbound events (via
 * `RedisNotificationRealtimePusher`), `sub` re-delivers inbound events to
 * this instance's LOCAL sockets through the injected `RealtimeDeliverer`
 * (design §3c/§6 — publish-then-receive-via-sub is the single delivery
 * path, including for the publishing instance itself).
 */
export class RedisRealtimeChannel {
  readonly pub: Redis;
  private readonly sub: Redis;
  private readonly deliverer: RealtimeDeliverer;
  private readonly onError?: (error: unknown) => void;

  constructor(deps: RedisRealtimeChannelDeps) {
    const factory = deps.createClient ?? defaultClientFactory;
    this.pub = factory(deps.redisUrl);
    this.sub = factory(deps.redisUrl);
    this.deliverer = deps.deliverer;
    this.onError = deps.onError;

    this.pub.on('error', (error: unknown) => this.onError?.(error));
    this.sub.on('error', (error: unknown) => this.onError?.(error));
    this.sub.on('message', (_channel: string, message: string) => {
      this.handleMessage(message);
    });
  }

  private handleMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as RealtimeMessage;
      this.deliverer.deliverTo(parsed.organizationId, parsed.userId, parsed);
    } catch (error) {
      this.onError?.(error);
    }
  }

  /** Subscribes `sub` to the shared channel. Never throws — a failure here degrades to local-only delivery (design §6). */
  async start(): Promise<void> {
    try {
      await this.sub.subscribe(REALTIME_CHANNEL);
    } catch (error) {
      this.onError?.(error);
    }
  }

  /**
   * Publishes `message` on the shared channel. Deliberately does NOT
   * swallow errors — `RedisNotificationRealtimePusher.send` (and, above it,
   * `SendNotification`'s own best-effort catch, tasks 6/35) is what owns
   * the swallow, so a caller that wants to observe/report a publish
   * failure still can.
   */
  async publish(message: RealtimeMessage): Promise<void> {
    await this.pub.publish(REALTIME_CHANNEL, JSON.stringify(message));
  }

  /** Safe even if Redis was never reachable (design §4 step 3). */
  async quit(): Promise<void> {
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
