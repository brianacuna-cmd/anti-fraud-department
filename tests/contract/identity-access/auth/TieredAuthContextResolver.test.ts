import type { Request } from 'express';
import { TieredAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TieredAuthContextResolver.js';
import type { AuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/AuthContextResolver.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

function fakeResolver(result: ReturnType<typeof createAuthContext> | null): AuthContextResolver {
  return { resolve: () => Promise.resolve(result) };
}

const REQ = {} as Request;

describe('TieredAuthContextResolver (design D6)', () => {
  it('returns the primary (session) resolution for a USER context', async () => {
    const userCtx = createAuthContext({ userId: 'u1', organizationId: null, actorType: 'USER' });
    const resolver = new TieredAuthContextResolver(fakeResolver(userCtx), null);

    await expect(resolver.resolve(REQ)).resolves.toEqual(userCtx);
  });

  it('returns the primary (session) resolution for an ORGANIZATION context', async () => {
    const orgCtx = createAuthContext({ userId: 'org1', organizationId: 'org1', actorType: 'ORGANIZATION' });
    const resolver = new TieredAuthContextResolver(fakeResolver(orgCtx), null);

    await expect(resolver.resolve(REQ)).resolves.toEqual(orgCtx);
  });

  it('returns null (no admin fallback) when primary fails and no admin resolver is configured', async () => {
    const resolver = new TieredAuthContextResolver(fakeResolver(null), null);

    await expect(resolver.resolve(REQ)).resolves.toBeNull();
  });

  it('returns null when primary fails and the admin fallback is configured but does not resolve', async () => {
    const resolver = new TieredAuthContextResolver(fakeResolver(null), fakeResolver(null));

    await expect(resolver.resolve(REQ)).resolves.toBeNull();
  });

  it('falls back to the admin resolver ONLY when primary fails AND the fallback resolves actorType=PLATFORM_ADMIN', async () => {
    const adminCtx = createAuthContext({ userId: 'admin1', organizationId: null, actorType: 'PLATFORM_ADMIN' });
    const resolver = new TieredAuthContextResolver(fakeResolver(null), fakeResolver(adminCtx));

    await expect(resolver.resolve(REQ)).resolves.toEqual(adminCtx);
  });

  it('ignores an admin-fallback result that resolves a non-PLATFORM_ADMIN actor (USER/ORG must never reach the fallback)', async () => {
    const userCtx = createAuthContext({ userId: 'u1', organizationId: null, actorType: 'USER' });
    const resolver = new TieredAuthContextResolver(fakeResolver(null), fakeResolver(userCtx));

    await expect(resolver.resolve(REQ)).resolves.toBeNull();
  });

  it('never consults the admin fallback when the primary already resolved (USER/ORG must never reach trusted-header)', async () => {
    const userCtx = createAuthContext({ userId: 'u1', organizationId: null, actorType: 'USER' });
    let adminCalled = false;
    const adminResolver: AuthContextResolver = {
      resolve: () => {
        adminCalled = true;
        return Promise.resolve(null);
      },
    };
    const resolver = new TieredAuthContextResolver(fakeResolver(userCtx), adminResolver);

    await resolver.resolve(REQ);

    expect(adminCalled).toBe(false);
  });
});
