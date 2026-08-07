import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { OrganizationRepository } from '../domain/ports/OrganizationRepository.js';
import type { OrganizationId } from '../domain/model/value-objects/OrganizationId.js';
import { Organization } from '../domain/model/aggregates/Organization.js';
import { createSlug } from '../domain/model/value-objects/Slug.js';
import { organizationSlugTaken } from '../domain/errors/IdentityAccessError.js';
import { requirePlatformAdmin } from './authorization/requirePlatformAdmin.js';

export interface CreateOrganizationInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly slug: string;
  readonly domain?: string | null;
}

export interface CreateOrganizationDeps {
  readonly organizations: OrganizationRepository;
  readonly clock: Clock;
  readonly generateId: () => OrganizationId;
}

/** Atomic Organization Bootstrap (organization half) — platform-admin only. */
export function createCreateOrganizationUseCase(deps: CreateOrganizationDeps) {
  return async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    requirePlatformAdmin(input.auth);

    const slug = createSlug(input.slug);
    const existing = await deps.organizations.findBySlug(slug);
    if (existing) {
      throw organizationSlugTaken(input.slug);
    }

    const organization = Organization.create({
      id: deps.generateId(),
      name: input.name,
      slug,
      domain: input.domain,
      now: deps.clock.now(),
    });

    await deps.organizations.save(organization);
    return organization;
  };
}
