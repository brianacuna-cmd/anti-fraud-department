import type { AssignedTo } from '../model/value-objects/AssignedTo.js';

/**
 * Resolves whether an assignee (USER or ROLE) belongs to an organization.
 * Identity lookup is an infrastructure concern — the composition root wires
 * a UserRepository/RoleRepository adapter; unit tests use an in-memory map.
 */
export interface AssigneeDirectory {
  belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean>;
}
