import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { PasswordHasher } from '../domain/ports/PasswordHasher.js';
import type { UserId } from '../domain/model/value-objects/UserId.js';
import { User } from '../domain/model/aggregates/User.js';
import { createOrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../domain/model/value-objects/Email.js';
import { userEmailTaken } from '../domain/errors/IdentityAccessError.js';

export interface CreateUserInput {
  readonly auth: AuthContext;
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly middleName?: string | null;
  readonly lastName: string;
  readonly avatarUrl?: string | null;
}

export interface CreateUserDeps {
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly passwordHasher: PasswordHasher;
  readonly clock: Clock;
  readonly generateId: () => UserId;
}

/**
 * Tenant-Scoped User Creation (user-lifecycle spec) — every user is created
 * inside the caller's OWN organization (no platform-admin gate: users routes
 * are tenant-scoped, not platform-admin-gated, per the
 * platform-admin-authorization spec).
 */
export function createCreateUserUseCase(deps: CreateUserDeps) {
  return async function createUser(input: CreateUserInput): Promise<User> {
    const organizationId = createOrganizationId(input.auth.organizationId);
    const repository = deps.userRepositoryFactory.forTenant(organizationId);

    const email = createEmail(input.email);
    const existing = await repository.findByEmail(email);
    if (existing) {
      throw userEmailTaken(input.email);
    }

    const credential = await deps.passwordHasher.hash(input.password);

    const user = User.create({
      id: deps.generateId(),
      organizationId,
      email,
      credential,
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      avatarUrl: input.avatarUrl,
      now: deps.clock.now(),
    });

    await repository.save(user);
    return user;
  };
}
