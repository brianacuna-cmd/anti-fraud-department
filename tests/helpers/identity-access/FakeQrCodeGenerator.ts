import type { QrCodeGenerator } from '../../../src/modules/identity-access/domain/ports/QrCodeGenerator.js';

/** Deterministic `QrCodeGenerator` fake for unit tests — no real PNG rendering. */
export class FakeQrCodeGenerator implements QrCodeGenerator {
  async toDataUrl(text: string): Promise<string> {
    return `data:image/png;base64,fake(${text})`;
  }
}
