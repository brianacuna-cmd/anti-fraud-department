import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../domain/model/value-objects/UserId.js';
import { createEmail } from '../domain/model/value-objects/Email.js';
import { userNotFound, userEmailTaken } from '../domain/errors/IdentityAccessError.js';

export interface PatchUserIdentityInput {
  readonly auth: AuthContext;
  readonly userId: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly middleName?: string | null;
  readonly avatarUrl?: string | null;
}

export interface PatchUserIdentityDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly clock: Clock;
}

/** User Identity Patch (user-lifecycle spec) — only firstName/lastName/email/avatarUrl. */
export function createPatchUserIdentityUseCase(deps: PatchUserIdentityDeps) {
  return async function patchUserIdentity(input: PatchUserIdentityInput): Promise<User> {
    const repository = deps.userRepositoryFactory.forTenant(createOrganizationId(input.auth.organizationId));

    const id = createUserId(input.userId);
    const user = await repository.findById(id);
    if (!user) {
      throw userNotFound(input.userId);
    }

    const email = input.email === undefined ? undefined : createEmail(input.email);
    if (email !== undefined && email !== user.email) {
      const conflicting = await repository.findByEmail(email);
      if (conflicting) {
        throw userEmailTaken(input.email!);
      }
    }

    const updated = user.patchIdentity(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email,
        middleName: input.middleName,
        avatarUrl: input.avatarUrl,
      },
      deps.clock.now(),
    );
    await repository.save(updated);
    return updated;
  };
}
