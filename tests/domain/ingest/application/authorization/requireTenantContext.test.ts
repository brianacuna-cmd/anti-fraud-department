import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { requireTenantContext } from '../../../../../src/modules/ingest/application/authorization/requireTenantContext.js';
import { IngestError } from '../../../../../src/modules/ingest/domain/errors/IngestError.js';

describe('requireTenantContext (ingest)', () => {
  it('returns the organizationId when the caller has tenant context', () => {
    const organizationId = oid('org-1');
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId,
      roleId: 'SUPERVISOR',
    });

    expect(requireTenantContext(auth)).toBe(organizationId);
  });

  it('rejects a null organizationId with FORBIDDEN_CROSS_TENANT', () => {
    const auth = createAuthContext({
      userId: oid('admin-1'),
      organizationId: null,
      isPlatformAdmin: true,
    });

    try {
      requireTenantContext(auth);
      throw new Error('expected requireTenantContext to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).code).toBe('FORBIDDEN_CROSS_TENANT');
    }
  });
});
