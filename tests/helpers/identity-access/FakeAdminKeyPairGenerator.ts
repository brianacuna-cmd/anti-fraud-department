import type {
  AdminKeyPairGenerator,
  GeneratedAdminKeyPair,
} from '../../../src/modules/identity-access/domain/ports/AdminKeyPairGenerator.js';

/**
 * Deterministic `AdminKeyPairGenerator` fake for unit tests — a single fixed,
 * real Ed25519 keypair (SPKI/PKCS8 PEM), generated once ahead of time.
 * Deterministic, not random: tests assert exact `publicKey` values without
 * re-deriving key material on every run.
 */
const FIXED_PUBLIC_KEY_SPKI_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA9xk1iF0soSPxKeL2FyWZVL+klmMUf6e/JDLP9t2HatY=
-----END PUBLIC KEY-----
`;

const FIXED_PRIVATE_KEY_PKCS8_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIM3kSOrGpmqFUfGrQTwZI/p1TUDwlvzDxbIOYME0hHIK
-----END PRIVATE KEY-----
`;

export class FakeAdminKeyPairGenerator implements AdminKeyPairGenerator {
  generateCallCount = 0;

  generate(): GeneratedAdminKeyPair {
    this.generateCallCount += 1;
    return {
      publicKeySpkiPem: FIXED_PUBLIC_KEY_SPKI_PEM,
      privateKeyPkcs8Pem: FIXED_PRIVATE_KEY_PKCS8_PEM,
    };
  }
}
