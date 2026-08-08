/**
 * Renders arbitrary text (an `otpauth://` URI, in MFA's case) as a QR code
 * image. Outbound port: the concrete implementation (`qrcode`) lives in
 * `infrastructure`, wired at the composition root.
 */
export interface QrCodeGenerator {
  /** A `data:image/png;base64,...` URL the client can render inline as an <img src>. */
  toDataUrl(text: string): Promise<string>;
}
