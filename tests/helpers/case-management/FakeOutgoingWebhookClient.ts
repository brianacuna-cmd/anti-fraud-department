import type {
  OutgoingWebhookClient,
  OutgoingWebhookPostInput,
  OutgoingWebhookPostResult,
} from '../../../src/modules/case-management/domain/ports/OutgoingWebhookClient.js';

/** Test double that records posts and returns a configurable result. */
export class FakeOutgoingWebhookClient implements OutgoingWebhookClient {
  readonly posts: OutgoingWebhookPostInput[] = [];
  nextResult: OutgoingWebhookPostResult = { statusCode: 200, ok: true };

  async post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult> {
    this.posts.push(input);
    return this.nextResult;
  }
}
