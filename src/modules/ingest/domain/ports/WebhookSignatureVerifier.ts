/**
 * Provider-specific signature check against the decrypted inbound secret
 * and the raw request body. Implementations live in ingest infrastructure.
 */
export interface WebhookSignatureVerifier {
  verify(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
  ): boolean;
}
