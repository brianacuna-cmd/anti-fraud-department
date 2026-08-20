import type { AssignedTo } from '../model/value-objects/AssignedTo.js';

/**
 * Resolves whether an assignee (USER or ROLE) belongs to an organization.
 * Identity lookup is an infrastructure concern — the composition root wires
 * a UserRepository/RoleRepository adapter; unit tests use an in-memory map.
 */
export interface AssigneeDirectory {
  belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean>;
  /**
   * Ids of the ACTIVE users assigned the given role within the organization —
   * the fan-out recipients for a ROLE-assigned case's notifications. Empty
   * when the role has no active members.
   */
  listRoleRecipients(organizationId: string, roleId: string): Promise<readonly string[]>;
}
