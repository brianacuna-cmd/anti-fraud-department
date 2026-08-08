import { authenticator } from 'otplib';
import { OtplibTotpService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/mfa/OtplibTotpService.js';

describe('OtplibTotpService', () => {
  const service = new OtplibTotpService();

  it('generates a non-empty secret, distinct across calls', () => {
    const a = service.generateSecret();
    const b = service.generateSecret();
    expect(a).toEqual(expect.any(String));
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('builds an otpauth://totp key URI carrying the issuer and secret', () => {
    const secret = service.generateSecret();
    const uri = service.keyUri('alice@example.com', 'AntiFraud', secret);

    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=AntiFraud');
    expect(uri).toContain(`secret=${secret}`);
  });

  it('verifies a currently-valid token for its secret', () => {
    const secret = service.generateSecret();
    const token = authenticator.generate(secret);

    expect(service.verify(token, secret)).toBe(true);
  });

  it('rejects a token that does not match the secret', () => {
    const secret = service.generateSecret();

    expect(service.verify('000000', secret)).toBe(false);
  });
});
