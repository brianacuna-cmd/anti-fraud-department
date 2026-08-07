import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { UserRepositoryFactory } from '../domain/ports/UserRepositoryFactory.js';
import type { PasswordHasher } from '../domain/ports/PasswordHasher.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { OrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import type { UserId } from '../domain/model/value-objects/UserId.js';
import { Organization } from '../domain/model/aggregates/Organization.js';
import { User } from '../domain/model/aggregates/User.js';
import { createSlug } from '../domain/model/value-objects/Slug.js';
import { createEmail } from '../domain/model/value-objects/Email.js';
import { organizationSlugTaken, userEmailTaken } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface CreateOrganizationWithAdminInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly slug: string;
  readonly domain?: string | null;
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly adminFirstName: string;
  readonly adminLastName: string;
}

export interface CreateOrganizationWithAdminDeps {
  readonly organizations: OrganizationRepository;
  readonly userRepositoryFactory: UserRepositoryFactory;
  readonly passwordHasher: PasswordHasher;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateOrganizationId: () => OrganizationId;
  readonly generateUserId: () => UserId;
}

/**
 * Atomic Organization Bootstrap (organization-lifecycle spec) — creates the
 * `Organization` AND its first admin `User` in one Mongo multi-document
 * transaction: both or neither. Platform-admin only (organizations routes
 * are 100% platform-admin-gated). Binds the admin's `UserRepository` to the
 * NEW organization's id, never the caller's own (design D8).
 */
export function createCreateOrganizationWithAdminUseCase(deps: CreateOrganizationWithAdminDeps) {
  return async function createOrganizationWithAdmin(
    input: CreateOrganizationWithAdminInput,
  ): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const slug = createSlug(input.slug);
      const existingOrganization = await deps.organizations.findBySlug(slug, tx);
      if (existingOrganization) {
        throw organizationSlugTaken(input.slug);
      }

      const adminEmail = createEmail(input.adminEmail);
      const emailTaken = await deps.userRepositoryFactory.existsByEmailAcrossTenants(adminEmail, tx);
      if (emailTaken) {
        throw userEmailTaken(input.adminEmail);
      }

      const now = deps.clock.now();
      const organization = Organization.create({
        id: deps.generateOrganizationId(),
        name: input.name,
        slug,
        domain: input.domain,
        now,
      });
      await deps.organizations.save(organization, tx);

      const credential = await deps.passwordHasher.hash(input.adminPassword);
      const adminUser = User.create({
        id: deps.generateUserId(),
        organizationId: organization.id,
        email: adminEmail,
        credential,
        firstName: input.adminFirstName,
        lastName: input.adminLastName,
        isPlatformAdmin: false,
        now,
      });
      const userRepository = deps.userRepositoryFactory.forTenant(organization.id);
      await userRepository.save(adminUser, tx);

      return organization;
    });
  };
}
