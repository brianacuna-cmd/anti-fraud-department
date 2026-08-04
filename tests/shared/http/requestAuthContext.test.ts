import type { Request } from 'express';
import {
  requireAuthContext,
  attachAuthContext,
} from '../../../src/shared/http/requestAuthContext.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';

describe('attachAuthContext / requireAuthContext', () => {
  it('reads back the exact AuthContext that was attached to the request', () => {
    const auth = createAuthContext({ userId: 'u1', organizationId: 'o1', isPlatformAdmin: true });
    const req = {} as Request;

    attachAuthContext(req, auth);

    expect(requireAuthContext(req)).toEqual(auth);
  });

  it('throws when no AuthContext was ever attached to the request', () => {
    const req = {} as Request;

    expect(() => requireAuthContext(req)).toThrow(/AuthContext/);
  });
});
