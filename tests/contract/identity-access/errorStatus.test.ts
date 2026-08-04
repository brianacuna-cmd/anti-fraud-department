import { identityAccessErrorStatus } from '../../../src/modules/identity-access/infrastructure/adapters/inbound/http/errorStatus.js';

describe('identityAccessErrorStatus', () => {
  it('maps every closed identity-access error code to its HTTP status (design errorStatus map)', () => {
    expect(identityAccessErrorStatus).toEqual({
      INVALID_TRANSITION: 422,
      FORBIDDEN_REACTIVATION: 403,
      FORBIDDEN_CROSS_TENANT: 403,
      ORGANIZATION_SLUG_TAKEN: 409,
      USER_EMAIL_TAKEN: 409,
      ORGANIZATION_NOT_FOUND: 404,
      USER_NOT_FOUND: 404,
      INVARIANT_VIOLATION: 400,
    });
  });
});
