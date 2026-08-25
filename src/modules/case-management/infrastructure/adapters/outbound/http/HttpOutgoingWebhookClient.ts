import { createHmac } from 'node:crypto';
import type {
  OutgoingWebhookClient,
  OutgoingWebhookPostInput,
  OutgoingWebhookPostResult,
} from '../../../../domain/ports/OutgoingWebhookClient.js';

export interface HttpOutgoingWebhookClientOptions {
  /** Injectable fetch for tests; defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Injectable clock for tests; defaults to `Date.now`. Seconds since epoch. */
  readonly nowSeconds?: () => number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Signing header. The name is ours; the format is Stripe's. */
export const SIGNATURE_HEADER = 'x-finturu-signature';
const SIGNATURE_SCHEME = 'v1';

/**
 * Production `OutgoingWebhookClient` — POSTs JSON payload to the tenant webhook URL.
 * Network/HTTP failures map to `{ ok: false }` (never throw) so the dispatcher can record attempts.
 *
 * EVT-003 — OUTBOUND SIGNATURE
 *
 * When the tenant has a secret configured, the delivery is signed with
 * HMAC-SHA256 over `${t}.${body}` in the `x-finturu-signature` header,
 * in the format `t=<epoch>,v1=<hex>`.
 *
 * WHY THIS FORMAT AND NOT A CUSTOM ONE
 *
 * It is exactly the one `StripeHmacVerifier` already verifies on the inbound
 * side. Whoever receives this almost certainly has working Stripe code, and
 * giving them a known scheme is the difference between them verifying the
 * signature and ignoring it because implementing it was work.
 *
 * WHY THE TIMESTAMP GOES INSIDE WHAT IS SIGNED
 *
 * Without it, a captured delivery can be replayed indefinitely and will keep
 * verifying. Signing `t` together with the body lets the receiver reject
 * stale ones — which is the only thing that turns the signature into replay
 * protection and not just proof of origin.
 *
 * The body is serialized ONCE and that exact string is signed. Serializing it
 * twice (once to sign, once to send) is how signatures that fail to verify
 * over a key-order difference are produced.
 */
export class HttpOutgoingWebhookClient implements OutgoingWebhookClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly nowSeconds: () => number;

  constructor(options: HttpOutgoingWebhookClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  async post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const body = JSON.stringify(input.payload);
    try {
      const response = await this.fetchImpl(input.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.signatureHeader(body, input.secret ?? null),
        },
        body,
        signal: controller.signal,
      });
      return {
        statusCode: response.status,
        ok: response.ok,
      };
    } catch {
      return { statusCode: 0, ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private signatureHeader(body: string, secret: string | null): Record<string, string> {
    if (secret === null || secret.length === 0) {
      return {};
    }
    const timestamp = this.nowSeconds();
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex');
    return { [SIGNATURE_HEADER]: `t=${timestamp},${SIGNATURE_SCHEME}=${signature}` };
  }
}
