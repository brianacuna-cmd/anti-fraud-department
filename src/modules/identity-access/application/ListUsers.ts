import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { UserListPage } from '../domain/ports/UserRepository.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface ListUsersInput {
  readonly auth: AuthContext;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListUsersDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
}

/** Tenant Isolation on List (user-lifecycle spec): never leaks another org's users. */
export function createListUsersUseCase(deps: ListUsersDeps) {
  return async function listUsers(input: ListUsersInput): Promise<UserListPage> {
    const repository = deps.userRepositoryFactory.forTenant(createOrganizationId(requireTenantContext(input.auth)));
    return repository.list(input.limit, input.cursor);
  };
}
