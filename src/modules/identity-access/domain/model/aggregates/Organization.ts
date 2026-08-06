import type { Instant } from '../../../../../shared/time/Instant.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { Slug } from '../value-objects/Slug.js';
import type { OrganizationStatus } from '../value-objects/OrganizationStatus.js';
import type { TransitionActor } from '../value-objects/TransitionActor.js';
import { ORGANIZATION_STATUS_TRANSITIONS } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export interface OrganizationProps {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: Slug;
  readonly domain: string | null;
  readonly status: OrganizationStatus;
  /**
   * Free-form, persistence/domain-only settings bag (design A11, schema-v2
   * PR5 — replaces `logoUrl`, design D8). Absent from every request/response
   * DTO and not patchable in this slice; defaults to `{}` on creation.
   */
  readonly configuration: Record<string, unknown>;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  /** Set to the transition instant on `CANCELLED` (design D10, organization-lifecycle spec). Never unset once written. */
  readonly deletedAt: Instant | null;
}

export interface CreateOrganizationInput {
  readonly id: OrganizationId;
  readonly name: string;
  readonly slug: Slug;
  readonly domain?: string | null;
  readonly now: Instant;
}

export interface PatchOrganizationIdentityInput {
  readonly name?: string;
  readonly domain?: string | null;
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
    assertNotBlankIfPresent('domain', input.domain);
    return new Organization({
      id: input.id,
      name: input.name,
      slug: input.slug,
      domain: input.domain ?? null,
      status: 'ACTIVE',
      configuration: {},
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
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

  get status(): OrganizationStatus {
    return this.props.status;
  }

  get configuration(): Record<string, unknown> {
    return this.props.configuration;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  get deletedAt(): Instant | null {
    return this.props.deletedAt;
  }

  toProps(): OrganizationProps {
    return this.props;
  }

  /** Only name/domain are patchable — slug is immutable; `configuration` is not patchable this slice (design A11). */
  patchIdentity(input: PatchOrganizationIdentityInput, now: Instant): Organization {
    const name = input.name ?? this.props.name;
    assertNonEmptyName(name);
    assertNotBlankIfPresent('domain', input.domain);
    return new Organization({
      ...this.props,
      name,
      domain: input.domain === undefined ? this.props.domain : input.domain,
      updatedAt: now,
    });
  }

  /**
   * No `reactivationEdge` is passed (design D10): `ORGANIZATION_STATUS_TRANSITIONS`'s
   * `CANCELLED: []` alone makes irreversibility hold for every actor, and
   * `SUSPENDED -> ACTIVE` needs no extra gate beyond the table (unlike
   * `User`'s `DISABLED -> ACTIVE`). A transition into `CANCELLED` stamps
   * `deletedAt` at the transition instant (organization-lifecycle spec:
   * "Organization Status Transition Matrix").
   */
  transitionTo(next: OrganizationStatus, actor: TransitionActor, now: Instant): Organization {
    assertTransitionAllowed(ORGANIZATION_STATUS_TRANSITIONS, this.props.status, next, actor);
    return new Organization({
      ...this.props,
      status: next,
      updatedAt: now,
      deletedAt: next === 'CANCELLED' ? now : this.props.deletedAt,
    });
  }
}

function assertNonEmptyName(name: string): void {
  if (name.trim().length === 0) {
    throw invariantViolation('Organization name must be a non-empty string', { name });
  }
}

/** `domain` is optional (undefined/null are both valid "absent"), but when present must not be blank. */
function assertNotBlankIfPresent(field: 'domain', value: string | null | undefined): void {
  if (value != null && value.trim().length === 0) {
    throw invariantViolation(`Organization ${field} must not be blank when provided`, { field, value });
  }
}
