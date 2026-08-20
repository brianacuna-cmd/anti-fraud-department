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

/**
 * Production `OutgoingWebhookClient` — POSTs JSON payload to the tenant webhook URL.
 * Network/HTTP failures map to `{ ok: false }` (never throw) so the dispatcher can record attempts.
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
    try {
      const response = await this.fetchImpl(input.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input.payload),
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
}
