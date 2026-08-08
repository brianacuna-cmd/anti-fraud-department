/**
 * TOTP (time-based one-time password) primitive for MFA (mfa-totp spec).
 * The plaintext secret produced here is NEVER persisted as-is — it is
 * encrypted at rest via `SecretCipher` before it touches an aggregate.
 * Outbound port: the concrete implementation (otplib) lives in
 * `infrastructure`, wired at the composition root.
 */
export interface TotpService {
  /** A fresh base32 shared secret for a new enrollment. */
  generateSecret(): string;
  /**
   * The `otpauth://totp/...` URI an authenticator app imports (usually via a
   * QR code). `accountName` identifies the user (e.g. their email), `issuer`
   * names the service.
   */
  keyUri(accountName: string, issuer: string, secret: string): string;
  /** `true` iff `token` is currently valid for `secret`. */
  verify(token: string, secret: string): boolean;
}
