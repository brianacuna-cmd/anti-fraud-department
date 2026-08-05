import type { Request, Response } from 'express';
import { createAuthContextMiddleware } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/authContextMiddleware.js';
import type { AuthContextResolver } from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/auth/AuthContextResolver.js';
import { requireAuthContext } from '../../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

function buildResolver(result: ReturnType<AuthContextResolver['resolve']>): AuthContextResolver {
  return { resolve: () => result };
}

describe('createAuthContextMiddleware', () => {
  it('attaches the resolved AuthContext to the request and calls next()', () => {
    const auth = createAuthContext({ userId: 'user-1', organizationId: 'org-1' });
    const middleware = createAuthContextMiddleware(buildResolver(auth));
    const request = {} as Request;
    const next = jest.fn();

    middleware(request, {} as Response, next);

    expect(requireAuthContext(request)).toEqual(auth);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() without attaching anything when the resolver finds no AuthContext', () => {
    const middleware = createAuthContextMiddleware(buildResolver(null));
    const request = {} as Request;
    const next = jest.fn();

    middleware(request, {} as Response, next);

    expect(() => requireAuthContext(request)).toThrow();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
