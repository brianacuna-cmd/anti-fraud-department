import type { Instant } from '../../../../../shared/time/Instant.js';
import type { WatchlistId } from '../value-objects/WatchlistId.js';
import type { WatchlistType } from '../value-objects/WatchlistType.js';
import type { WatchlistStatus } from '../value-objects/WatchlistStatus.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export interface WatchlistProps {
  readonly id: WatchlistId;
  readonly organizationId: string;
  readonly name: string;
  readonly source: string;
  readonly type: WatchlistType;
  readonly description: string | null;
  readonly status: WatchlistStatus;
  readonly deletedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateWatchlistInput {
  readonly id: WatchlistId;
  readonly organizationId: string;
  readonly name: string;
  readonly source: string;
  readonly type: WatchlistType;
  readonly description?: string | null;
  readonly now: Instant;
}

export interface UpdateWatchlistInput {
  readonly name?: string;
  readonly source?: string;
  readonly description?: string | null;
  readonly status?: WatchlistStatus;
}

/**
 * Watchlist named list (e.g. a sanctions blacklist or an internal
 * whitelist) that groups `WatchlistEntry` rows. Immutable — every mutating
 * method returns a brand-new instance, mirroring `AmlAlert`'s private-ctor
 * + create/rehydrate shape.
 */
export class Watchlist {
  private constructor(private readonly props: WatchlistProps) {}

  static create(input: CreateWatchlistInput): Watchlist {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('name', input.name);
    assertNonEmpty('source', input.source);
    return new Watchlist({
      id: input.id,
      organizationId: input.organizationId,
      name: input.name,
      source: input.source,
      type: input.type,
      description: input.description ?? null,
      status: 'ACTIVE',
      deletedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: WatchlistProps): Watchlist {
    return new Watchlist(props);
  }

  get id(): WatchlistId {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get source(): string {
    return this.props.source;
  }

  get type(): WatchlistType {
    return this.props.type;
  }

  get description(): string | null {
    return this.props.description;
  }

  get status(): WatchlistStatus {
    return this.props.status;
  }

  get deletedAt(): Instant | null {
    return this.props.deletedAt;
  }

  get createdAt(): Instant {
    return this.props.createdAt;
  }

  get updatedAt(): Instant {
    return this.props.updatedAt;
  }

  toProps(): WatchlistProps {
    return this.props;
  }

  update(changes: UpdateWatchlistInput, now: Instant): Watchlist {
    const name = changes.name ?? this.props.name;
    const source = changes.source ?? this.props.source;
    assertNonEmpty('name', name);
    assertNonEmpty('source', source);
    return new Watchlist({
      ...this.props,
      name,
      source,
      description: changes.description === undefined ? this.props.description : changes.description,
      status: changes.status ?? this.props.status,
      updatedAt: now,
    });
  }

  /** Soft-delete: status -> INACTIVE, deletedAt/updatedAt set to now. */
  softDelete(now: Instant): Watchlist {
    return new Watchlist({ ...this.props, status: 'INACTIVE', deletedAt: now, updatedAt: now });
  }
}

function assertNonEmpty(field: 'organizationId' | 'name' | 'source', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`Watchlist ${field} must be a non-empty string`, { field, value });
  }
}
