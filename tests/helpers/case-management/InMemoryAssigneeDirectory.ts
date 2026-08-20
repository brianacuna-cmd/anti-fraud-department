import type { AssigneeDirectory } from '../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';
import type { AssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';

/** In-memory membership map: orgId → set of `${type}:${id}` keys. */
export class InMemoryAssigneeDirectory implements AssigneeDirectory {
  private readonly members = new Map<string, Set<string>>();
  private readonly roleRecipients = new Map<string, string[]>();

  allow(organizationId: string, assignedTo: AssignedTo): void {
    const key = `${assignedTo.type}:${assignedTo.id}`;
    const set = this.members.get(organizationId) ?? new Set<string>();
    set.add(key);
    this.members.set(organizationId, set);
  }

  /** Register the active user ids returned by `listRoleRecipients(org, roleId)`. */
  allowRoleRecipients(organizationId: string, roleId: string, userIds: readonly string[]): void {
    this.roleRecipients.set(`${organizationId}:${roleId}`, [...userIds]);
  }

  async belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean> {
    return this.members.get(organizationId)?.has(`${assignedTo.type}:${assignedTo.id}`) ?? false;
  }

  async listRoleRecipients(organizationId: string, roleId: string): Promise<readonly string[]> {
    return this.roleRecipients.get(`${organizationId}:${roleId}`) ?? [];
  }
}
