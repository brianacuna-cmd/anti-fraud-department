import { createVerify } from 'node:crypto';
import type { WebhookSignatureVerifier } from '../../../../domain/ports/WebhookSignatureVerifier.js';
import { headerValue, parseTaggedSignature } from './signatureHeader.js';

const SCHEME = 'v0';
const TOLERANCE_MS = 10 * 60 * 1000;

/**
 * Bridge `X-Webhook-Signature` RSA-SHA256 over `${t}.${rawUtf8}` (`t=,v0=`).
 * `secret` is the decrypted PEM public key from inbound webhook secrets.
 * Fail-closed: missing header, stale timestamp (10 minutes), or PKI mismatch.
 */
export class BridgePkiVerifier implements WebhookSignatureVerifier {
  verify(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | undefined>>,
    secret: string,
  ): boolean {
    const header = headerValue(headers, 'x-webhook-signature');
    if (!header || !secret) {
      return false;
    }

    const parsed = parseTaggedSignature(header, SCHEME);
    if (parsed === null || parsed.signatures.length === 0) {
      return false;
    }

    const ageMs = Date.now() - parsed.timestamp;
    if (ageMs > TOLERANCE_MS || ageMs < -TOLERANCE_MS) {
      return false;
    }

    const signedPayload = `${parsed.timestamp}.${rawBody.toString('utf8')}`;
    return parsed.signatures.some((candidate) => verifyRsaSha256(signedPayload, candidate, secret));
  }
}

function verifyRsaSha256(signedPayload: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(signedPayload);
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}
