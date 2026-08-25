import type { Instant } from '../../../../../shared/time/Instant.js';
import type { WatchlistEntryId } from '../value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../value-objects/WatchlistId.js';
import type { EntryType } from '../value-objects/EntryType.js';
import type { RiskLevel } from '../value-objects/RiskLevel.js';
import type { WatchlistEntryStatus } from '../value-objects/WatchlistEntryStatus.js';
import { invariantViolation } from '../../errors/ScreeningError.js';

export interface WatchlistEntryProps {
  readonly id: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  readonly organizationId: string;
  readonly entryType: EntryType;
  readonly name: string;
  readonly document: string | null;
  readonly walletAddress: string | null;
  readonly riskLevel: RiskLevel | null;
  readonly country: string | null;
  readonly status: WatchlistEntryStatus;
  readonly deletedAt: Instant | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface CreateWatchlistEntryInput {
  readonly id: WatchlistEntryId;
  readonly watchlistId: WatchlistId;
  readonly organizationId: string;
  readonly entryType: EntryType;
  readonly name: string;
  readonly document?: string | null;
  readonly walletAddress?: string | null;
  readonly riskLevel?: RiskLevel | null;
  readonly country?: string | null;
  readonly now: Instant;
}

export interface UpdateWatchlistEntryInput {
  readonly name?: string;
  readonly document?: string | null;
  readonly walletAddress?: string | null;
  readonly riskLevel?: RiskLevel | null;
  readonly country?: string | null;
  readonly entryType?: EntryType;
}

/**
 * Write-side aggregate for a single watchlist entry (ADR-2). Immutable —
 * every mutating method returns a brand-new instance, mirroring `Watchlist`'s
 * private-ctor + create/rehydrate shape. Holds status-transition +
 * soft-delete invariants. The read-path `WatchlistCandidate` + existing
 * `WatchlistEntryDocument` read projection stay separate (RNF-5).
 */
export class WatchlistEntry {
  private constructor(private readonly props: WatchlistEntryProps) {}

  static create(input: CreateWatchlistEntryInput): WatchlistEntry {
    assertNonEmpty('organizationId', input.organizationId);
    assertNonEmpty('name', input.name);
    return new WatchlistEntry({
      id: input.id,
      watchlistId: input.watchlistId,
      organizationId: input.organizationId,
      entryType: input.entryType,
      name: input.name,
      document: input.document ?? null,
      walletAddress: input.walletAddress ?? null,
      riskLevel: input.riskLevel ?? null,
      country: input.country ?? null,
      status: 'ACTIVE',
      deletedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Reconstructs from persisted props — no business-rule validation. */
  static rehydrate(props: WatchlistEntryProps): WatchlistEntry {
    return new WatchlistEntry(props);
  }

  get id(): WatchlistEntryId {
    return this.props.id;
  }

  get watchlistId(): WatchlistId {
    return this.props.watchlistId;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get entryType(): EntryType {
    return this.props.entryType;
  }

  get name(): string {
    return this.props.name;
  }

  get document(): string | null {
    return this.props.document;
  }

  get walletAddress(): string | null {
    return this.props.walletAddress;
  }

  get riskLevel(): RiskLevel | null {
    return this.props.riskLevel;
  }

  get country(): string | null {
    return this.props.country;
  }

  get status(): WatchlistEntryStatus {
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

  toProps(): WatchlistEntryProps {
    return this.props;
  }

  update(changes: UpdateWatchlistEntryInput, now: Instant): WatchlistEntry {
    const name = changes.name ?? this.props.name;
    assertNonEmpty('name', name);
    return new WatchlistEntry({
      ...this.props,
      name,
      document: changes.document === undefined ? this.props.document : changes.document,
      walletAddress: changes.walletAddress === undefined ? this.props.walletAddress : changes.walletAddress,
      riskLevel: changes.riskLevel === undefined ? this.props.riskLevel : changes.riskLevel,
      country: changes.country === undefined ? this.props.country : changes.country,
      entryType: changes.entryType ?? this.props.entryType,
      updatedAt: now,
    });
  }

  /** Soft-delete: status -> REMOVED, deletedAt/updatedAt set to now. */
  softDelete(now: Instant): WatchlistEntry {
    return new WatchlistEntry({
      ...this.props,
      status: 'REMOVED',
      deletedAt: now,
      updatedAt: now,
    });
  }
}

function assertNonEmpty(field: 'organizationId' | 'name', value: string): void {
  if (value.trim().length === 0) {
    throw invariantViolation(`WatchlistEntry ${field} must be a non-empty string`, { field, value });
  }
}
