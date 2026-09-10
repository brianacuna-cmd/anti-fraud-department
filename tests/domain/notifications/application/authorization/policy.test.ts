import { oid } from '../../../../support/oid.js';
import { createAuthContext } from '../../../../../src/shared/kernel/AuthContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from '../../../../../src/modules/notifications/application/authorization/policy.js';
import { NotificationsError } from '../../../../../src/modules/notifications/domain/errors/NotificationsError.js';

const ORG = oid('org-1');

function user(roleId: string | null) {
  return createAuthContext({
    userId: oid('user-1'),
    organizationId: ORG,
    actorType: 'USER',
    roleId,
  });
}

const ORGANIZATION = createAuthContext({
  userId: ORG,
  organizationId: ORG,
  actorType: 'ORGANIZATION',
  roleId: null,
});

describe('requireOperationalRole (notifications)', () => {
  it('allows SUPERVISOR', () => {
    expect(() => requireOperationalRole(user('SUPERVISOR'), SUPERVISION_ROLES)).not.toThrow();
  });

  it('rejects ADMIN as read-only (governance plane), even when listed in the allowed set', () => {
    expect(() => requireOperationalRole(user('ADMIN'), ['SUPERVISOR', 'ADMIN'])).toThrow(NotificationsError);
  });

  it('rejects ANALYST', () => {
    expect(() => requireOperationalRole(user('ANALYST'), SUPERVISION_ROLES)).toThrow(NotificationsError);
  });

  it('rejects a governance-plane ORGANIZATION actor as read-only', () => {
    try {
      requireOperationalRole(ORGANIZATION, SUPERVISION_ROLES);
      throw new Error('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsError);
      expect((error as NotificationsError).code).toBe('FORBIDDEN_ROLE');
    }
  });

  it('rejects a null roleId', () => {
    expect(() => requireOperationalRole(user(null), SUPERVISION_ROLES)).toThrow(NotificationsError);
  });
});
