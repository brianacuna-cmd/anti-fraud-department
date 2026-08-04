import type { Request } from 'express';
import { TrustedHeaderAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TrustedHeaderAuthContextResolver.js';

function buildRequest(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

describe('TrustedHeaderAuthContextResolver', () => {
  const resolver = new TrustedHeaderAuthContextResolver();

  it('resolves an AuthContext from x-actor-* headers', () => {
    const request = buildRequest({
      'x-actor-user-id': 'user-1',
      'x-actor-organization-id': 'org-1',
      'x-actor-is-platform-admin': 'true',
    });

    const auth = resolver.resolve(request);

    expect(auth).toEqual({ userId: 'user-1', organizationId: 'org-1', isPlatformAdmin: true });
  });

  it('defaults isPlatformAdmin to false when the header is absent', () => {
    const request = buildRequest({ 'x-actor-user-id': 'user-1', 'x-actor-organization-id': 'org-1' });

    const auth = resolver.resolve(request);

    expect(auth?.isPlatformAdmin).toBe(false);
  });

  it('returns null when x-actor-user-id is missing', () => {
    const request = buildRequest({ 'x-actor-organization-id': 'org-1' });

    expect(resolver.resolve(request)).toBeNull();
  });

  it('returns null when x-actor-organization-id is missing', () => {
    const request = buildRequest({ 'x-actor-user-id': 'user-1' });

    expect(resolver.resolve(request)).toBeNull();
  });
});
