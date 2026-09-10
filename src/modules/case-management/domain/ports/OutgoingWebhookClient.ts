export interface OutgoingWebhookPostInput {
  readonly url: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Tenant secret used to HMAC-SHA256 the POSTed JSON body (`x-signature-sha256`).
   * `null` or empty = unsigned: the JSON is still posted and the signature
   * header is omitted. Replay defense is receiver idempotency on
   * `enforcement_action_id`.
   */
  readonly secret?: string | null;
  /**
   * Previous tenant secret. When present and non-empty, the client also
   * sends `x-signature-sha256-previous`. The caller decides whether grace is live.
   */
  readonly previousSecret?: string | null;
}

export interface OutgoingWebhookPostResult {
  readonly statusCode: number;
  readonly ok: boolean;
}

/** Port for POSTing enforcement outbox payloads to the tenant webhook URL. */
export interface OutgoingWebhookClient {
  post(input: OutgoingWebhookPostInput): Promise<OutgoingWebhookPostResult>;
}
