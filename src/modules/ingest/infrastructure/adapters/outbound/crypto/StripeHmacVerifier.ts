import { createHmac } from 'node:crypto';
import type { WebhookSignatureVerifier } from '../../../../domain/ports/WebhookSignatureVerifier.js';
import { headerValue, parseTaggedSignature, timingSafeEqualString } from './signatureHeader.js';

const SCHEME = 'v1';
const TOLERANCE_SECONDS = 300;

/**
 * Stripe `Stripe-Signature` HMAC-SHA256 over `${t}.${rawUtf8}` (`t=,v1=`).
 * Fail-closed: missing/malformed header, secret mismatch, or stale timestamp
 * returns false. HTTP mapping to WEBHOOK_SIGNATURE_INVALID is the caller's job.
 */
export class StripeHmacVerifier implements WebhookSignatureVerifier {
  verify(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
  ): boolean {
    const header = headerValue(headers, 'stripe-signature');
    if (!header || !secret) {
      return false;
    }

    const parsed = parseTaggedSignature(header, SCHEME);
    if (parsed === null) {
      return false;
    }

    const ageSeconds = Math.floor(Date.now() / 1000) - parsed.timestamp;
    if (ageSeconds > TOLERANCE_SECONDS || ageSeconds < -TOLERANCE_SECONDS) {
      return false;
    }

    const signedPayload = `${parsed.timestamp}.${rawBody.toString('utf8')}`;
    const expected = createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    return parsed.signatures.some((candidate) => timingSafeEqualString(candidate, expected));
  }
}
