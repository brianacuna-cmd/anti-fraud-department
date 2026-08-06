import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { userNotFound } from '../domain/errors/IdentityAccessError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface GetUserInput {
  readonly auth: AuthContext;
  readonly userId: string;
}

export interface GetUserDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
}

/**
 * Tenant Isolation on Read (user-lifecycle spec): binding the repository to
 * the caller's OWN organization makes a cross-tenant read structurally
 * return nothing — `USER_NOT_FOUND`, never another org's data.
 */
export function createGetUserUseCase(deps: GetUserDeps) {
  return async function getUser(input: GetUserInput): Promise<User> {
    const repository = deps.userRepositoryFactory.forTenant(createOrganizationId(requireTenantContext(input.auth)));

    const user = await repository.findById(createUserId(input.userId));
    if (!user) {
      throw userNotFound(input.userId);
    }
    return user;
  };
}
