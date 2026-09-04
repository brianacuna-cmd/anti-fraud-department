import { createHash } from 'node:crypto';
import { oid } from '../../../support/oid.js';
import {
  resolveAuthContextResolver,
  SessionAgentAuthContextResolver,
} from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/resolveAuthContextResolver.js';
import { TrustedHeaderAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TrustedHeaderAuthContextResolver.js';
import { AesGcmSecretCipher } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSecretCipher.js';
import { AesGcmSessionTokenService } from '../../../../src/modules/identity-access/infrastructure/adapters/outbound/crypto/AesGcmSessionTokenService.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryUserRepositoryFactory } from '../../../helpers/identity-access/InMemoryUserRepositoryFactory.js';
import { InMemoryAgentApiKeyRepository } from '../../../helpers/identity-access/InMemoryAgentApiKeyRepository.js';
import { AgentApiKey, createAgentApiKeyId } from '../../../../src/modules/identity-access/domain/model/aggregates/AgentApiKey.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createAuthContext, SYSTEM_AGENT_USER_ID } from '../../../../src/shared/kernel/AuthContext.js';
import type { AuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/AuthContextResolver.js';

describe('resolveAuthContextResolver', () => {
  it('returns a TrustedHeaderAuthContextResolver for AUTH_MODE=trusted-header (unchanged, global dev/staging bypass)', () => {
    const resolver = resolveAuthContextResolver('trusted-header');

    expect(resolver).toBeInstanceOf(TrustedHeaderAuthContextResolver);
  });

  it('throws an actionable error for an unsupported AUTH_MODE', () => {
    expect(() => resolveAuthContextResolver('jwt')).toThrow(/AUTH_MODE/);
  });

  it('returns a SessionAgentAuthContextResolver for AUTH_MODE=session when deps are given', () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const sessionRepository = new InMemorySessionRepository();

    const resolver = resolveAuthContextResolver('session', {
      sessionTokenService,
      sessionRepository,
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
    });

    expect(resolver).toBeInstanceOf(SessionAgentAuthContextResolver);
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

  it('resolves a valid X-Agent-Api-Key as system:agent ANALYST when session is missing', async () => {
    const sessionTokenService = new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1));
    const agentApiKeys = new InMemoryAgentApiKeyRepository();
    const plaintext = 'd'.repeat(64);
    await agentApiKeys.save(
      AgentApiKey.create({
        id: createAgentApiKeyId(oid('agent-key-1')),
        secretHash: createHash('sha256').update(plaintext, 'utf8').digest('hex'),
        organizationId: createOrganizationId(oid('org-1')),
      }),
    );
    const auth = await resolveAuthContextResolver('session', {
      sessionTokenService,
      sessionRepository: new InMemorySessionRepository(),
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
      agentApiKeyRepository: agentApiKeys,
    }).resolve({ headers: { 'x-agent-api-key': plaintext } } as unknown as import('express').Request);
    expect(auth).toMatchObject({ userId: SYSTEM_AGENT_USER_ID, actorType: 'USER', roleId: 'ANALYST', purpose: 'full' });
  });

  it('resolves demo USER trusted-header as SUPERVISOR when demoUserTrustedHeader is on', async () => {
    const auth = await resolveAuthContextResolver('session', {
      sessionTokenService: new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1)),
      sessionRepository: new InMemorySessionRepository(),
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
      demoUserTrustedHeader: true,
    }).resolve({
      headers: { 'x-actor-user-id': oid('u1'), 'x-actor-organization-id': oid('org-1') },
    } as unknown as import('express').Request);
    expect(auth).toMatchObject({
      userId: oid('u1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      roleId: 'SUPERVISOR',
    });
  });

  it('does not fall through to demo USER trusted-header when X-Agent-Api-Key is present but invalid', async () => {
    await expect(
      resolveAuthContextResolver('session', {
        sessionTokenService: new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1)),
        sessionRepository: new InMemorySessionRepository(),
        userRepositoryFactory: new InMemoryUserRepositoryFactory(),
        demoUserTrustedHeader: true,
      }).resolve({
        headers: {
          'x-agent-api-key': 'invalid-key',
          'x-actor-user-id': oid('u1'),
          'x-actor-organization-id': oid('org-1'),
        },
      } as unknown as import('express').Request),
    ).resolves.toBeNull();
  });

  it('does not fall through to admin interim when X-Agent-Api-Key is present but invalid', async () => {
    const resolver = resolveAuthContextResolver('session', {
      sessionTokenService: new AesGcmSessionTokenService(new AesGcmSecretCipher('secret', 1)),
      sessionRepository: new InMemorySessionRepository(),
      userRepositoryFactory: new InMemoryUserRepositoryFactory(),
      agentApiKeyRepository: new InMemoryAgentApiKeyRepository(),
      platformAdminAuth: 'trusted-header',
    });
    await expect(
      resolver.resolve({
        headers: { 'x-agent-api-key': 'invalid-key', 'x-actor-user-id': 'admin1', 'x-actor-is-platform-admin': 'true' },
      } as unknown as import('express').Request),
    ).resolves.toBeNull();
  });
});

describe('SessionAgentAuthContextResolver', () => {
  const fake = (result: ReturnType<typeof createAuthContext> | null): AuthContextResolver => ({
    resolve: async () => result,
  });
  const sessionCtx = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), actorType: 'USER' });
  const agentCtx = createAuthContext({
    userId: SYSTEM_AGENT_USER_ID,
    organizationId: oid('org-1'),
    actorType: 'USER',
    roleId: 'ANALYST',
  });

  it('prefers session even when X-Agent-Api-Key is also present', async () => {
    const auth = await new SessionAgentAuthContextResolver(fake(sessionCtx), fake(agentCtx), null).resolve({
      headers: { 'x-agent-api-key': 'present' },
    } as unknown as import('express').Request);
    expect(auth?.userId).toBe(oid('user-1'));
  });
});

