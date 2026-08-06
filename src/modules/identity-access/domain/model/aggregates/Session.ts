import type { Instant } from '../../../../../shared/time/Instant.js';
import type { SessionId } from '../value-objects/SessionId.js';
import type { FamilyId } from '../value-objects/FamilyId.js';
import type { OrganizationId } from '../value-objects/OrganizationId.js';
import type { ActorType } from '../value-objects/ActorType.js';

export interface SessionProps {
  readonly id: SessionId;
  /** Polymorphic principal id (User or admin principal) — plain string per design D37. `null` for ORGANIZATION. */
  readonly userId: string | null;
  readonly organizationId: OrganizationId | null;
  readonly actorType: ActorType;
  readonly tokenHash: string;
  /** Nullable — the `PLATFORM_ADMIN` tier issues no refresh token (design D38). */
  readonly refreshTokenHash: string | null;
  readonly expiresAt: Instant;
  readonly refreshExpiresAt: Instant | null;
  readonly familyId: FamilyId;
  /** Fixed at initial issuance, never extended by rotation (design D15). */
  readonly familyExpiresAt: Instant;
  readonly rotatedAt: Instant | null;
  readonly rotatedFromSessionId: SessionId | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  /** The SOLE revocation signal (design D14) — no separate `revokedAt`. */
  readonly deletedAt: Instant | null;
}

export interface CreateSessionInput {
  readonly id: SessionId;
  readonly userId: string | null;
  readonly organizationId: OrganizationId | null;
  readonly actorType: ActorType;
  readonly tokenHash: string;
  readonly refreshTokenHash: string | null;
  readonly expiresAt: Instant;
  readonly refreshExpiresAt: Instant | null;
  readonly familyId: FamilyId;
  readonly familyExpiresAt: Instant;
  readonly rotatedFromSessionId?: SessionId | null;
  readonly now: Instant;
}

/**
 * A `Sessions` row = ONE rotation generation, never the whole family (design
 * D14). Immutable, mirrors `Organization`/`User`'s private-ctor +
 * create/rehydrate shape. `refreshTokenHash`/`refreshExpiresAt` are nullable
 * (design D38) — a tier may issue a session without a refresh token; a
 * non-null constraint would make the `PLATFORM_ADMIN` tier unrepresentable.
 * `deletedAt` is the SOLE revocation signal (design D14) — `isRevoked` is
 * derived from it alone, deliberately with no separate `revokedAt` field to
 * disagree with.
 */
export class Session {
  private constructor(private readonly props: SessionProps) {}

  static create(input: CreateSessionInput): Session {
    return new Session({
      id: input.id,
      userId: input.userId,
      organizationId: input.organizationId,
      actorType: input.actorType,
      tokenHash: input.tokenHash,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      refreshExpiresAt: input.refreshExpiresAt,
      familyId: input.familyId,
      familyExpiresAt: input.familyExpiresAt,
      rotatedAt: null,
      rotatedFromSessionId: input.rotatedFromSessionId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
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

  get actorType(): ActorType {
    return this.props.actorType;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get refreshTokenHash(): string | null {
    return this.props.refreshTokenHash;
  }

  get expiresAt(): Instant {
    return this.props.expiresAt;
  }

  get refreshExpiresAt(): Instant | null {
    return this.props.refreshExpiresAt;
  }

  get familyId(): FamilyId {
    return this.props.familyId;
  }

  get familyExpiresAt(): Instant {
    return this.props.familyExpiresAt;
  }

  get rotatedAt(): Instant | null {
    return this.props.rotatedAt;
  }

  get rotatedFromSessionId(): SessionId | null {
    return this.props.rotatedFromSessionId;
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

  /** Derived purely from `deletedAt` (design D14) — never a separate stored flag. */
  get isRevoked(): boolean {
    return this.props.deletedAt !== null;
  }

  toProps(): SessionProps {
    return this.props;
  }
}
