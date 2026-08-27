import type { AssigneeDirectory } from '../../../src/modules/case-management/domain/ports/AssigneeDirectory.js';

/**
 * Says yes to everyone. For tests that build a `RouteCase`/`ReassignCase`/
 * `BulkCaseAction` use case but are not themselves exercising assignee
 * validation — without this stub, every one of them would also have to
 * become a directory test just to satisfy the required dependency. Tests
 * that DO exercise validation use the real (restrictive) `InMemoryAssigneeDirectory`
 * explicitly instead of this one.
 */
export class AllowAllAssigneeDirectory implements AssigneeDirectory {
  async belongsToOrganization(): Promise<boolean> {
    return true;
  }
  async listRoleRecipients(): Promise<readonly string[]> {
    return [];
  }
  async displayNames(): Promise<ReadonlyMap<string, string>> {
    return new Map();
  }
}
