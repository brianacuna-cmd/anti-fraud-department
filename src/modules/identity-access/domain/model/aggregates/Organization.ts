import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { Slug } from '../value-objects/Slug.js';
import type { LifecycleStatus } from '../value-objects/LifecycleStatus.js';
import type { TransitionActor } from '../value-objects/TransitionActor.js';
import { ORGANIZATION_TRANSITIONS } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export interface OrganizationProps {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: Slug;
  readonly domain: string | null;
  readonly status: LifecycleStatus;
  readonly logoUrl: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateOrganizationInput {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: Slug;
  readonly domain?: string | null;
  readonly logoUrl?: string | null;
  readonly now: Instant;
}

export interface PatchOrganizationIdentityInput {
  readonly name?: string;
  readonly domain?: string | null;
  readonly logoUrl?: string | null;
}

/**
 * Tenant root of the whole system (ESTRUCTURA_REPO.md §3: organizations
 * carries no `organizationId` — it IS the tenant). Immutable: every mutating
 * method returns a brand-new instance (design File Changes: "private ctor,
 * create/rehydrate/patchIdentity/transitionTo, all return new instances").
 */
export class Organization {
  private constructor(private readonly props: OrganizationProps) {}

  static create(input: CreateOrganizationInput): Organization {
    assertNonEmptyName(input.name);
    return new Organization({
      id: input.id,
      name: input.name,
      slug: input.slug,
      domain: input.domain ?? null,
      status: 'ACTIVO',
      logoUrl: input.logoUrl ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: OrganizationProps): Organization {
    return new Organization(props);
  }

  get id(): OrganizationId {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): Slug {
    return this.props.slug;
  }

  get domain(): string | null {
    return this.props.domain;
  }

  get status(): LifecycleStatus {
    return this.props.status;
  }

  get logoUrl(): string | null {
    return this.props.logoUrl;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): OrganizationProps {
    return this.props;
  }

  /** Only name/domain/logoUrl are patchable — slug is immutable. */
  patchIdentity(input: PatchOrganizationIdentityInput, now: Instant): Organization {
    const name = input.name ?? this.props.name;
    assertNonEmptyName(name);
    return new Organization({
      ...this.props,
      name,
      domain: input.domain === undefined ? this.props.domain : input.domain,
      logoUrl: input.logoUrl === undefined ? this.props.logoUrl : input.logoUrl,
      updatedAt: now,
    });
  }

  transitionTo(next: LifecycleStatus, actor: TransitionActor, now: Instant): Organization {
    assertTransitionAllowed(ORGANIZATION_TRANSITIONS, this.props.status, next, actor);
    return new Organization({ ...this.props, status: next, updatedAt: now });
  }
}

function assertNonEmptyName(name: string): void {
  if (name.trim().length === 0) {
    throw invariantViolation('Organization name must be a non-empty string', { name });
  }
}
