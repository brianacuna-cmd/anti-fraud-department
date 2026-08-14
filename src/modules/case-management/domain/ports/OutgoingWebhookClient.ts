export interface OutgoingWebhookPostInput {
  readonly url: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OutgoingWebhookPostResult {
  readonly statusCode: number;
  readonly ok: boolean;
}

/** Port for POSTing enforcement outbox payloads to the tenant webhook URL. */
export interface OutgoingWebhookClient {
  post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult>;
}
