/**
 * Outbound port for Ed25519 keypair generation (design D32). The only
 * capability this port exposes is generation — signing/verification is a
 * separate port (`SignatureVerifier`, PR 3b), and encryption of the private
 * key is the caller's responsibility via `SecretCipher`, not this port's.
 *
 * `publicKeySpkiPem`/`privateKeyPkcs8Pem` are the exact PEM encodings
 * `AdminKey.publicKey` and `SecretCipher.encrypt` consume — the adapter must
 * emit SPKI for the public key and PKCS8 for the private key (design D32).
 */
export interface GeneratedAdminKeyPair {
  readonly publicKeySpkiPem: string;
  readonly privateKeyPkcs8Pem: string;
}

export interface AdminKeyPairGenerator {
  generate(): GeneratedAdminKeyPair;
}
