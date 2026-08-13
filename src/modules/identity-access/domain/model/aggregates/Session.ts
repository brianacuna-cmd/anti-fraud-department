import type { Instant } from '../../../../../shared/time/Instant.js';
import type { SessionId } from '../value-objects/SessionId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { AdminOrganizationId } from '../value-objects/AdminOrganizationId.js';
import type { ActorType } from '../value-objects/ActorType.js';
import { invariantViolation } from '../../errors/IdentityAccessError.js';

export interface SessionProps {
  readonly id: SessionId;
  /** Set for a USER session; null otherwise. */
  readonly userId: string | null;
  /** Set for USER (tenant) and ORGANIZATION sessions; null for PLATFORM_ADMIN. */
  readonly organizationId: OrganizationId | null;
  /** Set for a SUPER ADMIN session; null otherwise. */
  readonly adminOrganizationId: AdminOrganizationId | null;
  readonly tokenHash: string;
  readonly expiresAt: Instant;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Instant;
  /** The SOLE revocation signal — no separate `revokedAt`. */
  readonly deletedAt: Instant | null;
}

export interface CreateSessionInput {
  readonly id: SessionId;
  readonly userId?: string | null;
  readonly organizationId?: OrganizationId | null;
  readonly adminOrganizationId?: AdminOrganizationId | null;
  readonly tokenHash: string;
  readonly expiresAt: Instant;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly now: Instant;
}

function actorTypeOf(props: {
  readonly userId: string | null;
  readonly organizationId: OrganizationId | null;
  readonly adminOrganizationId: AdminOrganizationId | null;
}): ActorType {
  if (props.adminOrganizationId !== null && (props.userId !== null || props.organizationId !== null)) {
    throw invariantViolation('PLATFORM_ADMIN session cannot carry userId or organizationId');
  }
  if (props.adminOrganizationId !== null) {
    return 'PLATFORM_ADMIN';
  }
  if (props.userId !== null) {
    return 'USER';
  }
  if (props.organizationId !== null) {
    return 'ORGANIZATION';
  }
  throw invariantViolation('Session must set userId, organizationId, or adminOrganizationId');
}

/**
 * A `sessions` row: one live (or revoked) access session. Actor kind is
 * derived from which FK is set — USER (`user_id`), ORGANIZATION
 * (`organization_id` only), or PLATFORM_ADMIN (`admin_organization_id`).
 */
export class Session {
  private constructor(private readonly props: SessionProps) {}

  static create(input: CreateSessionInput): Session {
    const userId = input.userId ?? null;
    const organizationId = input.organizationId ?? null;
    const adminOrganizationId = input.adminOrganizationId ?? null;
    actorTypeOf({ userId, organizationId, adminOrganizationId });
    return new Session({
      id: input.id,
      userId,
      organizationId,
      adminOrganizationId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: input.now,
      deletedAt: null,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: SessionProps): Session {
    return new Session(props);
  }

  get id(): SessionId {
    return this.props.id;
  }

  get userId(): string | null {
    return this.props.userId;
  }

  get organizationId(): OrganizationId | null {
    return this.props.organizationId;
  }

  get adminOrganizationId(): AdminOrganizationId | null {
    return this.props.adminOrganizationId;
  }

  get actorType(): ActorType {
    return actorTypeOf(this.props);
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get expiresAt(): Instant {
    return this.props.expiresAt;
  }

  get ipAddress(): string | null {
    return this.props.ipAddress;
  }

  get userAgent(): string | null {
    return this.props.userAgent;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get deletedAt(): Instant | null {
    return this.props.deletedAt;
  }

  get isRevoked(): boolean {
    return this.props.deletedAt !== null;
  }

  toProps(): SessionProps {
    return this.props;
  }
}
