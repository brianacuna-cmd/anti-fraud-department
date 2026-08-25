export interface OutgoingWebhookPostInput {
  readonly url: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Tenant secret used to sign the delivery. `null` = unsigned, which is
   * what exists for integrations prior to EVT-003; the receiver then cannot
   * distinguish our sends from anyone else's who knows their URL.
   */
  readonly secret?: string | null;
}

export interface OutgoingWebhookPostResult {
  readonly statusCode: number;
  readonly ok: boolean;
}

/** Port for POSTing enforcement outbox payloads to the tenant webhook URL. */
export interface OutgoingWebhookClient {
  post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult>;
}
