import { resolveAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TrustedHeaderAuthContextResolver.js';
import { SessionTokenAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/SessionTokenAuthContextResolver.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';

describe('resolveAuthContextResolver', () => {
  it('returns a TrustedHeaderAuthContextResolver for AUTH_MODE=trusted-header', () => {
    const resolver = resolveAuthContextResolver('trusted-header');

    expect(resolver).toBeInstanceOf(TrustedHeaderAuthContextResolver);
  });

  it('throws an actionable error for an unsupported AUTH_MODE', () => {
    expect(() => resolveAuthContextResolver('jwt')).toThrow(/AUTH_MODE/);
  });

  it('returns a SessionTokenAuthContextResolver for AUTH_MODE=session when deps are given (design D12)', () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const sessionRepository = new InMemorySessionRepository();

    const resolver = resolveAuthContextResolver('session', { sessionTokenService, sessionRepository });

    expect(resolver).toBeInstanceOf(SessionTokenAuthContextResolver);
  });

  it('throws an actionable error for AUTH_MODE=session when deps are missing', () => {
    expect(() => resolveAuthContextResolver('session')).toThrow(/AUTH_MODE=session/);
  });
});
