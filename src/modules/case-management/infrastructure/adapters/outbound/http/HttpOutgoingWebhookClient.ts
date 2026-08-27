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
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** Ticket name `X-Signature-SHA256`; Node/Express see lowercase. */
export const SIGNATURE_HEADER = 'x-signature-sha256';

/**
 * Production `OutgoingWebhookClient` — POSTs JSON payload to the tenant webhook URL.
 * Network/HTTP failures map to `{ ok: false }` (never throw) so the dispatcher can record attempts.
 *
 * When the tenant has a secret configured, the delivery is signed with HMAC-SHA256
 * of the exact POSTed JSON body. The header is `x-signature-sha256` and the value
 * is lowercase hex. There is no timestamp in the MAC.
 *
 * Replay defense is receiver idempotency on `enforcement_action_id`. Dispatcher
 * retries of the same payload produce the same MAC.
 *
 * The body is serialized ONCE and that exact string is signed. Serializing it
 * twice (once to sign, once to send) is how signatures that fail to verify
 * over a key-order difference are produced.
 *
 * Missing or empty secret: the JSON body is still POSTed and the signature
 * header is omitted (not fail-closed).
 */
export class HttpOutgoingWebhookClient implements OutgoingWebhookClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpOutgoingWebhookClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    return { [SIGNATURE_HEADER]: signature };
  }
}
