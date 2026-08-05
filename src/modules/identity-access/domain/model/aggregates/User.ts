import type { Instant } from '../../../../../shared/time/Instant.js';
import type { UserId } from '../value-objects/UserId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { Email } from '../value-objects/Email.js';
import type { PasswordCredential } from '../value-objects/PasswordCredential.js';
import type { LifecycleStatus } from '../value-objects/LifecycleStatus.js';
import type { TransitionActor } from '../value-objects/TransitionActor.js';
import { USER_TRANSITIONS } from '../../services/transitions.js';
import { assertTransitionAllowed } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export interface UserProps {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly email: Email;
  readonly credential: PasswordCredential;
  readonly firstName: string;
  readonly lastName: string;
  readonly avatarUrl: string | null;
  readonly status: LifecycleStatus;
  readonly isPlatformAdmin: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateUserInput {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly email: Email;
  readonly credential: PasswordCredential;
  readonly firstName: string;
  readonly lastName: string;
  readonly avatarUrl?: string | null;
  readonly isPlatformAdmin?: boolean;
  readonly now: Instant;
}

export interface PatchUserIdentityInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: Email;
  readonly avatarUrl?: string | null;
}

/**
 * Tenant-scoped member of an `Organization` (design File Changes). Immutable:
 * every mutating method returns a brand-new instance, same shape as
 * `Organization` (private ctor, create/rehydrate/patchIdentity/transitionTo).
 */
export class User {
  private constructor(private readonly props: UserProps) {}

  static create(input: CreateUserInput): User {
    assertNonEmpty('firstName', input.firstName);
    assertNonEmpty('lastName', input.lastName);
    assertNotBlankIfPresent('avatarUrl', input.avatarUrl);
    return new User({
      id: input.id,
      organizationId: input.organizationId,
      email: input.email,
      credential: input.credential,
      firstName: input.firstName,
      lastName: input.lastName,
      avatarUrl: input.avatarUrl ?? null,
      status: 'ACTIVE',
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: UserProps): User {
    return new User(props);
  }

  get id(): UserId {
    return this.props.id;
  }

  get organizationId(): OrganizationId {
    return this.props.organizationId;
  }

  get email(): Email {
    return this.props.email;
  }

  get credential(): PasswordCredential {
    return this.props.credential;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get avatarUrl(): string | null {
    return this.props.avatarUrl;
  }

  get status(): LifecycleStatus {
    return this.props.status;
  }

  get isPlatformAdmin(): boolean {
    return this.props.isPlatformAdmin;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): UserProps {
    return this.props;
  }

  /** Only firstName/lastName/email/avatarUrl are patchable (user-lifecycle spec: "User Identity Patch"). */
  patchIdentity(input: PatchUserIdentityInput, now: Instant): User {
    const firstName = input.firstName ?? this.props.firstName;
    const lastName = input.lastName ?? this.props.lastName;
    assertNonEmpty('firstName', firstName);
    assertNonEmpty('lastName', lastName);
    assertNotBlankIfPresent('avatarUrl', input.avatarUrl);
    return new User({
      ...this.props,
      firstName,
      lastName,
      email: input.email ?? this.props.email,
      avatarUrl: input.avatarUrl === undefined ? this.props.avatarUrl : input.avatarUrl,
      updatedAt: now,
    });
  }

  transitionTo(next: LifecycleStatus, actor: TransitionActor, now: Instant): User {
    assertTransitionAllowed(USER_TRANSITIONS, this.props.status, next, actor);
    return new User({ ...this.props, status: next, updatedAt: now });
  }
}

function assertNonEmpty(field: 'firstName' | 'lastName', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`User ${field} must be a non-empty string`, { field });
  }
}

/** `avatarUrl` is optional (undefined/null are both valid "absent"), but when present must not be blank. */
function assertNotBlankIfPresent(field: 'avatarUrl', value: string | null | undefined): void {
  if (value != null && value.trim().length === 0) {
    throw invariantViolation(`User ${field} must not be blank when provided`, { field, value });
  }
}
