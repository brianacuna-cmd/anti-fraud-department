import type {
  OutgoingWebhookClient,
  OutgoingWebhookPostInput,
  OutgoingWebhookPostResult,
} from '../../../src/modules/case-management/domain/ports/OutgoingWebhookClient.js';

/** Test double that records posts and returns a configurable result (or queue). */
export class FakeOutgoingWebhookClient implements OutgoingWebhookClient {
  readonly posts: OutgoingWebhookPostInput[] = [];
  nextResult: OutgoingWebhookPostResult = { statusCode: 200, ok: true };
  /** When non-empty, each `post` shifts the next result (then falls back to `nextResult`). */
  resultQueue: OutgoingWebhookPostResult[] = [];
  /** When set, the next `post` rejects with this error (then clears). */
  nextError: Error | null = null;

  async post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult> {
    this.posts.push(input);
    if (this.nextError !== null) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    const queued = this.resultQueue.shift();
    return queued ?? this.nextResult;
  }
}
