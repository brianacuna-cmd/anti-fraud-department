import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { requireRole } from '../../../../../src/modules/ingest/application/authorization/requireRole.js';
import { IngestError } from '../../../../../src/modules/ingest/domain/errors/IngestError.js';

const ORG = oid('org-1');
const ALLOWED = ['SUPERVISOR', 'ADMIN'] as const;

describe('requireRole (ingest)', () => {
  it('allows SUPERVISOR when listed in allowed roles', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'SUPERVISOR',
    });

    expect(() => requireRole(auth, ALLOWED)).not.toThrow();
  });

  it('allows ADMIN when listed in allowed roles', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'ADMIN',
    });

    expect(() => requireRole(auth, ALLOWED)).not.toThrow();
  });

  it('rejects AUDITOR with FORBIDDEN_ROLE', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'AUDITOR',
    });

    try {
      requireRole(auth, ALLOWED);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', () => {
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: ORG,
      roleId: 'ANALYST',
    });

    try {
      requireRole(auth, ALLOWED);
      throw new Error('expected requireRole to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).code).toBe('FORBIDDEN_ROLE');
    }
  });
});
