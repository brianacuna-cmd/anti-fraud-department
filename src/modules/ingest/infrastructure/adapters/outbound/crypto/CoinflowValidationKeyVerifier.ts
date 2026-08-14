import type { WebhookSignatureVerifier } from '../../../../domain/ports/WebhookSignatureVerifier.js';
import { headerValue, timingSafeEqualString } from './signatureHeader.js';

/**
 * Coinflow dashboard Validation Key compared to `Authorization` with
 * `timingSafeEqual`. The header is NOT a session Bearer token — a `Bearer `
 * prefix is not stripped and JWT session auth is never applied here.
 */
export class CoinflowValidationKeyVerifier implements WebhookSignatureVerifier {
  verify(
    _rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
  ): boolean {
    const authorization = headerValue(headers, 'authorization');
    if (!authorization || !secret) {
      return false;
    }
    return timingSafeEqualString(authorization, secret);
  }
}
