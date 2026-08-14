import type { Request } from 'express';
import {
  requireAuthContext,
  requireAuthContextAnyScope,
  attachAuthContext,
} from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { UnauthenticatedError } from '../../../src/shared/kernel/UnauthenticatedError.js';

describe('attachAuthContext / requireAuthContext', () => {
  it('reads back the exact AuthContext that was attached to the request', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', isPlatformAdmin: true });
    const req = {} as Request;

    attachAuthContext(req, auth);

    expect(requireAuthContext(req)).toEqual(auth);
  });

  it('throws when no AuthContext was ever attached to the request', () => {
    const req = {} as Request;

    expect(() => requireAuthContext(req)).toThrow(UnauthenticatedError);
  });

  it('rejects a "challenge"-scoped AuthContext (design D3 default-deny)', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'challenge' });
    const req = {} as Request;
    attachAuthContext(req, auth);

    expect(() => requireAuthContext(req)).toThrow(/full-scope/);
  });

  it('rejects an "enrollment"-scoped AuthContext (design D3 default-deny)', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'enrollment' });
    const req = {} as Request;
    attachAuthContext(req, auth);

    expect(() => requireAuthContext(req)).toThrow(/full-scope/);
  });

  it('accepts a "full"-scoped AuthContext', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'full' });
    const req = {} as Request;
    attachAuthContext(req, auth);

    expect(requireAuthContext(req)).toEqual(auth);
  });
});

describe('requireAuthContextAnyScope', () => {
  it('returns a non-full-scope AuthContext without throwing', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', purpose: 'challenge' });
    const req = {} as Request;
    attachAuthContext(req, auth);

    expect(requireAuthContextAnyScope(req)).toEqual(auth);
  });

  it('throws when no AuthContext was ever attached to the request', () => {
    const req = {} as Request;

    expect(() => requireAuthContextAnyScope(req)).toThrow(UnauthenticatedError);
  });
});
