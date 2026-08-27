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
    async listRoleRecipients(organizationId: string, roleId: string): Promise<readonly string[]> {
      try {
        const users = await userRepositoryFactory
          .forTenant(createOrganizationId(organizationId))
          .listByRole(createRoleId(roleId));
        return users.map((user) => user.id as string);
      } catch {
        return [];
      }
    },
    async displayNames(
      organizationId: string,
      assignees: readonly AssignedTo[],
    ): Promise<ReadonlyMap<string, string>> {
      // At most eight (the `workload` cap), so one read per assignee is cheap
      // and avoids a `findManyByIds` method on the identity-access port just
      // for this.
      const users = userRepositoryFactory.forTenant(createOrganizationId(organizationId));
      const resolved = new Map<string, string>();

      for (const assignee of assignees) {
        const name =
          assignee.type === 'USER'
            ? await userDisplayName(users, assignee.id)
            : await roleDisplayName(roleRepository, assignee.id);
        if (name !== null) resolved.set(assignee.id, name);
      }
      return resolved;
    },
  };
}

/**
 * The user's full name, or their email if no name is loaded.
 * `null` when the id does not resolve — deleted user or invalid id shape —:
 * the dashboard prefers a nameless bar to a made-up name.
 */
async function userDisplayName(
  users: ReturnType<UserRepositoryFactory['forTenant']>,
  userIdRaw: string,
): Promise<string | null> {
  try {
    const user = await users.findById(createUserId(userIdRaw));
    if (!user) return null;
    const name = `${user.firstName} ${user.lastName}`.trim();
    return name.length > 0 ? name : (user.email as string);
  } catch {
    return null;
  }
}

async function roleDisplayName(
  roleRepository: RoleRepository,
  roleIdRaw: string,
): Promise<string | null> {
  try {
    const role = await roleRepository.findById(createRoleId(roleIdRaw));
    return role?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * `findById` only checks that the user exists and belongs to the tenant —
 * it deliberately still resolves deactivated users (`userDisplayName` above
 * needs that, to label a timeline entry for someone who has since been
 * suspended). Assignment is different: a case handed to a SUSPENDED/INACTIVE/
 * DISABLED user is not "assigned to someone who can't work it", it is
 * assigned to no one, silently. `ACTIVE` is the only status that can receive
 * a case.
 */
async function userBelongsToOrganization(
  userRepositoryFactory: UserRepositoryFactory,
  organizationId: string,
  userIdRaw: string,
): Promise<boolean> {
  try {
    const organizationIdBranded = createOrganizationId(organizationId);
    const userId = createUserId(userIdRaw);
    const user = await userRepositoryFactory.forTenant(organizationIdBranded).findById(userId);
    return user !== null && user.status === 'ACTIVE';
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
