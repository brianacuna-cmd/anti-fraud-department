import type { AssigneeDirectory } from '../modules/case-management/domain/ports/AssigneeDirectory.js';
import type { AssignedTo } from '../modules/case-management/domain/model/value-objects/AssignedTo.js';
import type { UserRepositoryFactory } from '../modules/identity-access/domain/ports/UserRepositoryFactory.js';
import type { RoleRepository } from '../modules/identity-access/domain/ports/RoleRepository.js';
import { createOrganizationId } from '../modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../modules/identity-access/domain/model/value-objects/RoleId.js';

/**
 * Composition-root bridge: implements case-management's `AssigneeDirectory`
 * by looking up Users (tenant-scoped) and Roles (global catalog) via
 * identity-access ports. Lives outside module folders so cross-module
 * imports are legal (same pattern as `caseManagementAuditRecorderAdapter`).
 *
 * Invalid id shapes are treated as "not a member" (return false) rather than
 * leaking identity-access validation errors into the case-management path.
 */
export function createIdentityAssigneeDirectory(
  userRepositoryFactory: UserRepositoryFactory,
  roleRepository: RoleRepository,
): AssigneeDirectory {
  return {
    async belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean> {
      if (assignedTo.type === 'USER') {
        return userBelongsToOrganization(userRepositoryFactory, organizationId, assignedTo.id);
      }
      return roleIsAssignable(roleRepository, assignedTo.id);
    },
  };
}

async function userBelongsToOrganization(
  userRepositoryFactory: UserRepositoryFactory,
  organizationId: string,
  userIdRaw: string,
): Promise<boolean> {
  try {
    const organizationIdBranded = createOrganizationId(organizationId);
    const userId = createUserId(userIdRaw);
    const user = await userRepositoryFactory.forTenant(organizationIdBranded).findById(userId);
    return user !== null;
  } catch {
    return false;
  }
}

async function roleIsAssignable(roleRepository: RoleRepository, roleIdRaw: string): Promise<boolean> {
  try {
    return await roleRepository.isAssignableToUser(createRoleId(roleIdRaw));
  } catch {
    return false;
  }
}
