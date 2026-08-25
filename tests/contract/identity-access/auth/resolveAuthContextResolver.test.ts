import { oid } from '../../../support/oid.js';
import { resolveAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TrustedHeaderAuthContextResolver.js';
import { TieredAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TieredAuthContextResolver.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';

describe('resolveAuthContextResolver', () => {
  it('returns a TrustedHeaderAuthContextResolver for AUTH_MODE=trusted-header (unchanged, global dev/staging bypass)', () => {
    const resolver = resolveAuthContextResolver('trusted-header');

    expect(resolver).toBeInstanceOf(TrustedHeaderAuthContextResolver);
  });

  it('throws an actionable error for an unsupported AUTH_MODE', () => {
    expect(() => resolveAuthContextResolver('jwt')).toThrow(/AUTH_MODE/);
  });

  it('returns a TieredAuthContextResolver for AUTH_MODE=session when deps are given (design D6)', () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const sessionRepository = new InMemorySessionRepository();

    const resolver = resolveAuthContextResolver('session', {
      sessionTokenService,
      sessionRepository,
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
    });

    expect(resolver).toBeInstanceOf(TieredAuthContextResolver);
  });

  it('throws an actionable error for AUTH_MODE=session when deps are missing', () => {
    expect(() => resolveAuthContextResolver('session')).toThrow(/AUTH_MODE=session/);
  });

  it('does not wire an admin fallback when platformAdminAuth is omitted/disabled (default)', async () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const sessionRepository = new InMemorySessionRepository();

    const resolver = resolveAuthContextResolver('session', {
      sessionTokenService,
      sessionRepository,
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
    });

    // No Authorization header and no trusted-header fallback => null, not a
    // resolved PLATFORM_ADMIN/USER context from trusted headers.
    const req = { headers: {} } as import('express').Request;
    await expect(resolver.resolve(req)).resolves.toBeNull();
  });

  it('wires an admin-only trusted-header fallback when platformAdminAuth=trusted-header (design D6)', async () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const sessionRepository = new InMemorySessionRepository();

    const resolver = resolveAuthContextResolver('session', {
      sessionTokenService,
      sessionRepository,
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
      platformAdminAuth: 'trusted-header',
    });

    const req = {
      headers: { 'x-actor-user-id': 'admin1', 'x-actor-is-platform-admin': 'true' },
    } as unknown as import('express').Request;

    const context = await resolver.resolve(req);
    expect(context?.actorType).toBe('PLATFORM_ADMIN');
  });

  it('does NOT resolve a USER/ORG context through the trusted-header fallback even when platformAdminAuth=trusted-header', async () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const sessionRepository = new InMemorySessionRepository();

    const resolver = resolveAuthContextResolver('session', {
      sessionTokenService,
      sessionRepository,
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
      platformAdminAuth: 'trusted-header',
    });

    const req = {
      headers: { 'x-actor-user-id': oid('u1') },
    } as unknown as import('express').Request;

    await expect(resolver.resolve(req)).resolves.toBeNull();
  });
});
