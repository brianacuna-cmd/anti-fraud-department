import QRCode from 'qrcode';
import type { QrCodeGenerator } from '../../../../domain/ports/QrCodeGenerator.js';

/**
 * `QrCodeGenerator` backed by the `qrcode` library — the only place allowed to
 * import it. Emits a PNG data URL so the MFA setup response can hand the client
 * a directly-renderable image of the `otpauth://` URI.
 */
export class QrCodeDataUrlGenerator implements QrCodeGenerator {
  toDataUrl(text: string): Promise<string> {
    return QRCode.toDataURL(text);
  }
}
