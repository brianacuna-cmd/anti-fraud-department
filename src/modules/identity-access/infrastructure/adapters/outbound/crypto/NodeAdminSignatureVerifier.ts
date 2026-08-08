import { createPublicKey, verify } from 'node:crypto';
import type { SignatureVerifier } from '../../../../domain/ports/SignatureVerifier.js';

/**
 * The only adapter allowed to call `node:crypto`'s `verify` for the admin
 * tier (design D32, sibling to `NodeAdminKeyPairGenerator`). Ed25519 is a
 * one-shot signature scheme — the curve defines the hash internally, so
 * `algorithm` is `null` (mirrors `NodeAdminKeyPairGenerator.test.ts`'s
 * `sign(null, ...)`/`verify(null, ...)` usage). Fail-closed: any malformed
 * PEM/base64 signature becomes `false`, never an exception (design D13's
 * `SecretCipher.decrypt` fail-closed contract, applied here).
 */
export class NodeAdminSignatureVerifier implements SignatureVerifier {
  verify(message: Buffer, signatureBase64: string, publicKeySpkiPem: string): boolean {
    try {
      const publicKey = createPublicKey({ key: publicKeySpkiPem, format: 'pem', type: 'spki' });
      const signature = Buffer.from(signatureBase64, 'base64');
      return verify(null, message, publicKey, signature);
    } catch {
      return false;
    }
  }
}
