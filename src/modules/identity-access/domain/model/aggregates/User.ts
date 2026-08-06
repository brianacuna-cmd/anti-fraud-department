import type { Instant } from '../../../../../shared/time/Instant.js';
import type { UserId } from '../value-objects/UserId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { Email } from '../value-objects/Email.js';
import type { PasswordCredential } from '../value-objects/PasswordCredential.js';
import type { LifecycleStatus } from '../value-objects/LifecycleStatus.js';
import type { TransitionActor } from '../value-objects/TransitionActor.js';
import { USER_TRANSITIONS } from '../../services/transitions.js';
import { assertTransitionAllowed, type ReactivationEdge } from '../../services/StatusTransitionPolicy.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

/**
 * The single actor-gated edge in `USER_TRANSITIONS` (design D9, unchanged
 * by D10's generalization): reactivating a `DISABLED` user requires a
 * platform administrator.
 */
const USER_REACTIVATION_EDGE: ReactivationEdge<LifecycleStatus> = { from: 'DISABLED', to: 'ACTIVE' };

/** Persistence/domain-only password-reset state (design A11) — never surfaces on a DTO. */
export interface ResetToken {
  readonly hash: string;
  readonly expiresAt: Instant;
}

/** Persistence/domain-only MFA state (design A11) — never surfaces on a DTO; no use case reads or writes it in this slice. */
export interface MfaSettings {
  readonly secret: string | null;
  readonly enabled: boolean;
  readonly recoveryCodes: readonly string[];
}

export interface UserProps {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly email: Email;
  readonly credential: PasswordCredential;
  readonly firstName: string;
  readonly middleName: string | null;
  readonly lastName: string;
  readonly avatarUrl: string | null;
  readonly status: LifecycleStatus;
  readonly isPlatformAdmin: boolean;
  readonly resetToken: ResetToken | null;
  readonly mfa: MfaSettings;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateUserInput {
  readonly id: UserId;
  readonly organizationId: OrganizationId;
  readonly email: Email;
  readonly credential: PasswordCredential;
  readonly firstName: string;
  readonly middleName?: string | null;
  readonly lastName: string;
  readonly avatarUrl?: string | null;
  readonly isPlatformAdmin?: boolean;
  readonly now: Instant;
}

export interface PatchUserIdentityInput {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: Email;
  readonly middleName?: string | null;
  readonly avatarUrl?: string | null;
}

/** Default MFA state for every newly-created user (design A11 — inert until a future auth slice consumes it). */
const DEFAULT_MFA: MfaSettings = { secret: null, enabled: false, recoveryCodes: [] };

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
    assertNotBlankIfPresent('middleName', input.middleName);
    return new User({
      id: input.id,
      organizationId: input.organizationId,
      email: input.email,
      credential: input.credential,
      firstName: input.firstName,
      middleName: input.middleName ?? null,
      lastName: input.lastName,
      avatarUrl: input.avatarUrl ?? null,
      status: 'ACTIVE',
      isPlatformAdmin: input.isPlatformAdmin ?? false,
      resetToken: null,
      mfa: DEFAULT_MFA,
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

  get middleName(): string | null {
    return this.props.middleName;
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

  get resetToken(): ResetToken | null {
    return this.props.resetToken;
  }

  get mfa(): MfaSettings {
    return this.props.mfa;
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

  /**
   * Only firstName/lastName/email/middleName/avatarUrl are patchable
   * (user-lifecycle spec: "User Identity Patch"; design A12 adds
   * `middleName`). `resetToken`/`mfa` are persistence/domain-only and never
   * change here (design A11).
   */
  patchIdentity(input: PatchUserIdentityInput, now: Instant): User {
    const firstName = input.firstName ?? this.props.firstName;
    const lastName = input.lastName ?? this.props.lastName;
    assertNonEmpty('firstName', firstName);
    assertNonEmpty('lastName', lastName);
    assertNotBlankIfPresent('avatarUrl', input.avatarUrl);
    assertNotBlankIfPresent('middleName', input.middleName);
    return new User({
      ...this.props,
      firstName,
      lastName,
      email: input.email ?? this.props.email,
      middleName: input.middleName === undefined ? this.props.middleName : input.middleName,
      avatarUrl: input.avatarUrl === undefined ? this.props.avatarUrl : input.avatarUrl,
      updatedAt: now,
    });
  }

  transitionTo(next: LifecycleStatus, actor: TransitionActor, now: Instant): User {
    assertTransitionAllowed(USER_TRANSITIONS, this.props.status, next, actor, USER_REACTIVATION_EDGE);
    return new User({ ...this.props, status: next, updatedAt: now });
  }
}

function assertNonEmpty(field: 'firstName' | 'lastName', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`User ${field} must be a non-empty string`, { field });
  }
}

/** `avatarUrl`/`middleName` are optional (undefined/null are both valid "absent"), but when present must not be blank. */
function assertNotBlankIfPresent(field: 'avatarUrl' | 'middleName', value: string | null | undefined): void {
  if (value != null && value.trim().length === 0) {
    throw invariantViolation(`User ${field} must not be blank when provided`, { field, value });
  }
}
