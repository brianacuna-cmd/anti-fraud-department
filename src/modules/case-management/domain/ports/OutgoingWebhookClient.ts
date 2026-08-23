export interface OutgoingWebhookPostInput {
  readonly url: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /**
   * Secreto del inquilino para firmar la entrega. `null` = sin firma, que es
   * lo que hay para integraciones anteriores a EVT-003; el receptor entonces
   * no puede distinguir nuestros envios de los de cualquiera que conozca su
   * URL.
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
