import { QrCodeDataUrlGenerator } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/QrCodeDataUrlGenerator.js';

describe('QrCodeDataUrlGenerator', () => {
  const generator = new QrCodeDataUrlGenerator();

  it('renders text as a PNG data URL', async () => {
    const dataUrl = await generator.toDataUrl('otpauth://totp/AntiFraud:alice@example.com?secret=ABC123&issuer=AntiFraud');

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUrl.length).toBeGreaterThan('data:image/png;base64,'.length);
  });

  it('produces different images for different inputs', async () => {
    const a = await generator.toDataUrl('otpauth://totp/AntiFraud:a?secret=AAA');
    const b = await generator.toDataUrl('otpauth://totp/AntiFraud:b?secret=BBB');

    expect(a).not.toBe(b);
  });
});
