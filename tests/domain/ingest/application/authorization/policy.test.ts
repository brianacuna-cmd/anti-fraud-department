import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import {
  requireOperationalRole,
  SECRET_WRITE_ROLES,
} from '../../../../../src/modules/ingest/application/authorization/policy.js';
import { IngestError } from '../../../../../src/modules/ingest/domain/errors/IngestError.js';

const ORG = oid('org-1');

function user(roleId: string | null) {
  return createAuthContext({ userId: oid('user-1'), organizationId: ORG, actorType: 'USER', roleId });
}

function expectForbidden(run: () => void): IngestError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(IngestError);
    expect((error as IngestError).code).toBe('FORBIDDEN_ROLE');
    return error as IngestError;
  }
  throw new Error('expected the guard to throw');
}

describe('requireOperationalRole (ingest)', () => {
  it('allows SUPERVISOR', () => {
    expect(() => requireOperationalRole(user('SUPERVISOR'), SECRET_WRITE_ROLES)).not.toThrow();
  });

  it.each(['ADMIN', 'AUDITOR'])('rejects %s as read-only', (roleId) => {
    const error = expectForbidden(() => requireOperationalRole(user(roleId), SECRET_WRITE_ROLES));
    expect(error.metadata).toMatchObject({ actor: roleId, readOnly: true });
  });

  it('rejects the ORGANIZATION actor as read-only, not as a null role', () => {
    const organization = createAuthContext({
      userId: ORG,
      organizationId: ORG,
      actorType: 'ORGANIZATION',
      roleId: null,
    });

    const error = expectForbidden(() => requireOperationalRole(organization, SECRET_WRITE_ROLES));
    expect(error.metadata).toMatchObject({ actor: 'ORGANIZATION', readOnly: true });
  });

  it('rejects ANALYST', () => {
    expectForbidden(() => requireOperationalRole(user('ANALYST'), SECRET_WRITE_ROLES));
  });

  it('rejects a USER with no role at all', () => {
    expectForbidden(() => requireOperationalRole(user(null), SECRET_WRITE_ROLES));
  });
});
