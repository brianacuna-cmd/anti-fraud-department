import type { Request } from 'express';
import { requireScopedAuthContext } from '../../../../src/modules/identity-access/application/authorization/requireScopedAuthContext.js';
import { attachAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

function buildRequest(): Request {
  return {} as Request;
}

describe('requireScopedAuthContext', () => {
  it('accepts a purpose included in the allow-list', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'enrollment' });
    const req = buildRequest();
    attachAuthContext(req, auth);

    expect(requireScopedAuthContext(req, { allow: ['full', 'enrollment'] })).toEqual(auth);
  });

  it('accepts "full" when it is in the allow-list', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'full' });
    const req = buildRequest();
    attachAuthContext(req, auth);

    expect(requireScopedAuthContext(req, { allow: ['full', 'enrollment'] })).toEqual(auth);
  });

  it('rejects a purpose not in the allow-list', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'challenge' });
    const req = buildRequest();
    attachAuthContext(req, auth);

    expect(() => requireScopedAuthContext(req, { allow: ['full', 'enrollment'] })).toThrow(/purpose/);
  });

  it('throws when no AuthContext was ever attached', () => {
    const req = buildRequest();

    expect(() => requireScopedAuthContext(req, { allow: ['full'] })).toThrow(/authentication required/);
  });
});
