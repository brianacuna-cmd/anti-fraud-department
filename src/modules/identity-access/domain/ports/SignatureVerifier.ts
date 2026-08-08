/**
 * Outbound port for verifying Ed25519 signatures produced by a PLATFORM_ADMIN
 * private key against the ACTIVE `AdminKey.publicKey` (design D32,
 * super-admin-auth). Verification-only — signing happens client-side, key
 * generation is a separate port (`AdminKeyPairGenerator`).
 */
export interface SignatureVerifier {
  /**
   * `message` and `signatureBase64` are the exact canonical bytes the
   * caller signed / the base64-encoded signature it produced;
   * `publicKeySpkiPem` is the stored `AdminKey.publicKey` (SPKI PEM).
   * Returns `true` ONLY for a valid Ed25519 signature over `message` under
   * `publicKeySpkiPem` — NEVER throws (malformed PEM/signature → `false`,
   * mirrors `SecretCipher.decrypt`'s fail-closed contract).
   */
  verify(message: Buffer, signatureBase64: string, publicKeySpkiPem: string): boolean;
}
