import type { AssigneeDirectory } from '../modules/case-management/domain/ports/AssigneeDirectory.js';
import type { AssignedTo } from '../modules/case-management/domain/model/value-objects/AssignedTo.js';
import type { UserRepositoryFactory } from '../modules/identity-access/domain/ports/UserRepositoryFactory.js';
import type { RoleRepository } from '../modules/identity-access/domain/ports/RoleRepository.js';
import { createOrganizationId } from '../modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../modules/identity-access/domain/model/value-objects/UserId.js';
import { createRoleId } from '../modules/identity-access/domain/model/value-objects/RoleId.js';
import { OPERATIONAL_ROLES } from '../shared/kernel/AccessTier.js';

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
    async canWorkCases(organizationId: string, assignedTo: AssignedTo): Promise<boolean> {
      if (assignedTo.type === 'ROLE') {
        return OPERATIONAL_ROLES.includes(assignedTo.id);
      }
      const roleId = await userRoleId(userRepositoryFactory, organizationId, assignedTo.id);
      return roleId !== null && OPERATIONAL_ROLES.includes(roleId);
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
      // Son como mucho ocho (el tope de `workload`), asi que una lectura por
      // asignatario es barata y evita un metodo `findManyByIds` en el puerto
      // de identity-access solo para esto.
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
 * Nombre completo del usuario, o su correo si no tiene nombre cargado.
 * `null` cuando el id no resuelve —usuario borrado o id con forma invalida—:
 * el panel prefiere una barra sin nombre a un nombre inventado.
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

/**
 * El rol del usuario, o `null` si el id no resuelve.
 *
 * Un id que no resuelve se trata como «no puede instruir» y no como error, por
 * lo mismo que `belongsToOrganization`: quien pregunta está decidiendo si
 * asignar, y ante la duda no se asigna.
 */
async function userRoleId(
  userRepositoryFactory: UserRepositoryFactory,
  organizationId: string,
  userIdRaw: string,
): Promise<string | null> {
  try {
    const user = await userRepositoryFactory
      .forTenant(createOrganizationId(organizationId))
      .findById(createUserId(userIdRaw));
    return user === null ? null : (user.roleId as string);
  } catch {
    return null;
  }
}
