import type { AssignedTo } from '../model/value-objects/AssignedTo.js';

/**
 * Resolves whether an assignee (USER or ROLE) belongs to an organization.
 * Identity lookup is an infrastructure concern — the composition root wires
 * a UserRepository/RoleRepository adapter; unit tests use an in-memory map.
 */
export interface AssigneeDirectory {
  belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean>;
  /**
   * `true` when the assignee sits in the OPERATIONS plane and can therefore
   * instruct cases.
   *
   * Belonging to the tenant is not enough: ADMIN and AUDITOR are governance —
   * they administer people and audit — and act on no case. A file in an
   * auditor's tray is worked by nobody, and it breaks the segregation of
   * duties the rest of the access policy rests on.
   */
  canWorkCases(organizationId: string, assignedTo: AssignedTo): Promise<boolean>;
  /**
   * Ids of the ACTIVE users assigned the given role within the organization —
   * the fan-out recipients for a ROLE-assigned case's notifications. Empty
   * when the role has no active members.
   */
  listRoleRecipients(organizationId: string, roleId: string): Promise<readonly string[]>;
  /**
   * Readable names for a handful of assignees, by their id.
   *
   * The workload dashboard returns them: without this each assignee's bar is
   * labeled with a hexadecimal ObjectId, which tells nobody who has the cases
   * on their plate. An id that does not resolve (deleted user, retired role)
   * simply does not appear in the map, and the caller decides how to label it.
   */
  displayNames(
    organizationId: string,
    assignees: readonly AssignedTo[],
  ): Promise<ReadonlyMap<string, string>>;
}
