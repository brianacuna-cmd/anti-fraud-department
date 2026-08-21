import type { AssigneeDirectory } from '../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';
import type { AssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';

/** In-memory membership map: orgId → set of `${type}:${id}` keys. */
export class InMemoryAssigneeDirectory implements AssigneeDirectory {
  private readonly members = new Map<string, Set<string>>();
  private readonly roleRecipients = new Map<string, string[]>();
  private readonly names = new Map<string, string>();

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

  /** Registra el nombre legible de un asignatario (`${type}:${id}` → nombre). */
  nameFor(organizationId: string, assignedTo: AssignedTo, name: string): void {
    this.names.set(`${organizationId}:${assignedTo.type}:${assignedTo.id}`, name);
  }

  async belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean> {
    return this.members.get(organizationId)?.has(`${assignedTo.type}:${assignedTo.id}`) ?? false;
  }

  async listRoleRecipients(organizationId: string, roleId: string): Promise<readonly string[]> {
    return this.roleRecipients.get(`${organizationId}:${roleId}`) ?? [];
  }

  async displayNames(
    organizationId: string,
    assignees: readonly AssignedTo[],
  ): Promise<ReadonlyMap<string, string>> {
    const resolved = new Map<string, string>();
    for (const assignee of assignees) {
      const name = this.names.get(`${organizationId}:${assignee.type}:${assignee.id}`);
      if (name !== undefined) resolved.set(assignee.id, name);
    }
    return resolved;
  }
}
