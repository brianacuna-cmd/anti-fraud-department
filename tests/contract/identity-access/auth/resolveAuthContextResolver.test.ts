import { resolveAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TrustedHeaderAuthContextResolver.js';

describe('resolveAuthContextResolver', () => {
  it('returns a TrustedHeaderAuthContextResolver for AUTH_MODE=trusted-header', () => {
    const resolver = resolveAuthContextResolver('trusted-header');

    expect(resolver).toBeInstanceOf(TrustedHeaderAuthContextResolver);
  });

  it('throws an actionable error for an unsupported AUTH_MODE', () => {
    expect(() => resolveAuthContextResolver('jwt')).toThrow(/AUTH_MODE/);
  });
});
