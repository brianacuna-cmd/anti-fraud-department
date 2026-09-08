import { oid } from '../../../support/oid.js';
import type { Request } from 'express';
import { TrustedHeaderAuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/TrustedHeaderAuthContextResolver.js';

function buildRequest(headers: Record<string, string | undefined>): Request {
  return { headers } as unknown as Request;
}

describe('TrustedHeaderAuthContextResolver', () => {
  const resolver = new TrustedHeaderAuthContextResolver();

  it('resolves an AuthContext from x-actor-* headers', async () => {
    const request = buildRequest({
      'x-actor-user-id': oid('user-1'),
      'x-actor-organization-id': oid('org-1'),
      'x-actor-is-platform-admin': 'true',
    });

    const auth = await resolver.resolve(request);

    expect(auth).toEqual({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      isPlatformAdmin: true,
      actorType: 'PLATFORM_ADMIN',
      roleId: null,
      sessionId: null,
      ipAddress: null,
      purpose: 'full',
      mfaJti: null,
    });
  });

  it('defaults isPlatformAdmin to false and actorType to USER when the header is absent', async () => {
    const request = buildRequest({ 'x-actor-user-id': oid('user-1'), 'x-actor-organization-id': oid('org-1') });

    const auth = await resolver.resolve(request);

    expect(auth?.isPlatformAdmin).toBe(false);
    expect(auth?.actorType).toBe('USER');
    expect(auth?.roleId).toBe('SUPERVISOR');
  });

  it('honors x-actor-role-id for a USER when present', async () => {
    const request = buildRequest({
      'x-actor-user-id': oid('user-1'),
      'x-actor-organization-id': oid('org-1'),
      'x-actor-role-id': 'ANALYST',
    });

    const auth = await resolver.resolve(request);

    expect(auth?.roleId).toBe('ANALYST');
  });

  it('resolves organizationId: null when the header is absent (design D11 — a platform admin has no organization)', async () => {
    const request = buildRequest({ 'x-actor-user-id': oid('admin-1'), 'x-actor-is-platform-admin': 'true' });

    const auth = await resolver.resolve(request);

    expect(auth?.organizationId).toBeNull();
    expect(auth?.actorType).toBe('PLATFORM_ADMIN');
  });

  it('returns null when x-actor-user-id is missing', async () => {
    const request = buildRequest({ 'x-actor-organization-id': oid('org-1') });

    expect(await resolver.resolve(request)).toBeNull();
  });
});
