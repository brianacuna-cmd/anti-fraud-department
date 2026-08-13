import type { AssigneeDirectory } from '../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';
import type { AssignedTo } from '../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';

/** In-memory membership map: orgId → set of `${type}:${id}` keys. */
export class InMemoryAssigneeDirectory implements AssigneeDirectory {
  private readonly members = new Map<string, Set<string>>();

  allow(organizationId: string, assignedTo: AssignedTo): void {
    const key = `${assignedTo.type}:${assignedTo.id}`;
    const set = this.members.get(organizationId) ?? new Set<string>();
    set.add(key);
    this.members.set(organizationId, set);
  }

  async belongsToOrganization(organizationId: string, assignedTo: AssignedTo): Promise<boolean> {
    return this.members.get(organizationId)?.has(`${assignedTo.type}:${assignedTo.id}`) ?? false;
  }
}
