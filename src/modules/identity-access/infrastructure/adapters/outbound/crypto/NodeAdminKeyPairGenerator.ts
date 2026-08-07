import { generateKeyPairSync } from 'node:crypto';
import type { AdminKeyPairGenerator, GeneratedAdminKeyPair } from '../../../../domain/ports/AdminKeyPairGenerator.js';

/**
 * The only file allowed to call `generateKeyPairSync` for the admin tier
 * (design D32). Node native `crypto` — no new dependency, verified against
 * `package.json`. Emits SPKI (public) / PKCS8 (private) PEM, matching what
 * `AdminKey.publicKey` and `SecretCipher.encrypt` expect.
 */
export class NodeAdminKeyPairGenerator implements AdminKeyPairGenerator {
  generate(): GeneratedAdminKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return {
      publicKeySpkiPem: publicKey,
      privateKeyPkcs8Pem: privateKey,
    };
  }
}
