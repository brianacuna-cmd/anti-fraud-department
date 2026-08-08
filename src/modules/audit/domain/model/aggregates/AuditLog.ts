import type { Instant } from '../../../../../shared/time/Instant.js';
import type { AuditLogId } from '../value-objects/AuditLogId.js';
import type { ActorType } from '../ActorType.js';

export interface AuditLogProps {
  readonly id: AuditLogId;
  /** `null` for a PLATFORM_ADMIN actor operating outside any tenant (design D-A6 — no sentinel). */
  readonly organizationId: string | null;
  readonly actorType: ActorType;
  /** Plain string — cross-module id, not branded (design D-A9). */
  readonly actorId: string;
  readonly action: string;
  readonly resource: string;
  readonly resourceId: string | null;
  /** Always an object, never an array or null (design D-A8/spec "Record created with required shape"). */
  readonly detail: Record<string, unknown>;
  readonly ipAddress: string | null;
  readonly createdAt: Instant;
}

/**
 * Append-only audit record (design D-A8). No `update`/`delete`/transition
 * methods exist by design — the sole write path is `AuditLogRepository.save`
 * from a freshly created instance; a persisted `AuditLog` is never mutated.
 */
export class AuditLog {
  private constructor(private readonly props: AuditLogProps) {}

  static create(props: AuditLogProps): AuditLog {
    return new AuditLog(props);
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: AuditLogProps): AuditLog {
    return new AuditLog(props);
  }

  get id(): AuditLogId {
    return this.props.id;
  }

  get organizationId(): string | null {
    return this.props.organizationId;
  }

  get actorType(): ActorType {
    return this.props.actorType;
  }

  get actorId(): string {
    return this.props.actorId;
  }

  get action(): string {
    return this.props.action;
  }

  get resource(): string {
    return this.props.resource;
  }

  get resourceId(): string | null {
    return this.props.resourceId;
  }

  get detail(): Record<string, unknown> {
    return this.props.detail;
  }

  get ipAddress(): string | null {
    return this.props.ipAddress;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  toProps(): AuditLogProps {
    return this.props;
  }
}
