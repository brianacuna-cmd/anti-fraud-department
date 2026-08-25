import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { WatchlistEntry } from '../domain/model/aggregates/WatchlistEntry.js';
import type { WatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import type { EntryType } from '../domain/model/value-objects/EntryType.js';
import type { RiskLevel } from '../domain/model/value-objects/RiskLevel.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import { WatchlistEntry as WatchlistEntryAggregate } from '../domain/model/aggregates/WatchlistEntry.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface CreateWatchlistEntryInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
  readonly name: string;
  readonly entryType: EntryType;
  readonly document?: string | null;
  readonly walletAddress?: string | null;
  readonly riskLevel?: RiskLevel | null;
  readonly country?: string | null;
}

export interface CreateWatchlistEntryDeps {
  readonly watchlistRepository: WatchlistRepository;
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateWatchlistEntryId: () => WatchlistEntryId;
  readonly indexWatchlistEntry: (input: { entryId: WatchlistEntryId; tx?: Transaction }) => Promise<void>;
}

/**
 * RF-6: creates an entry under an existing, non-deleted, same-org watchlist.
 * `indexWatchlistEntry` is called AFTER `create` and BEFORE the audit row
 * so normalization commits atomically with the entry write (ADR-3).
 * `organizationId` ALWAYS from `requireTenantContext`, never from body.
 */
export function createCreateWatchlistEntryUseCase(deps: CreateWatchlistEntryDeps) {
  return async function createWatchlistEntry(input: CreateWatchlistEntryInput): Promise<WatchlistEntry> {
    const organizationId = requireTenantContext(input.auth);
    const watchlistId = createWatchlistId(input.watchlistId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const watchlist = await deps.watchlistRepository.findById(watchlistId, tx);
      if (watchlist === null || watchlist.organizationId !== organizationId || watchlist.deletedAt !== null) {
        throw watchlistNotFound(input.watchlistId);
      }

      const now = deps.clock.now();
      const entry = WatchlistEntryAggregate.create({
        id: deps.generateWatchlistEntryId(),
        watchlistId,
        organizationId,
        entryType: input.entryType,
        name: input.name,
        document: input.document ?? null,
        walletAddress: input.walletAddress ?? null,
        riskLevel: input.riskLevel ?? null,
        country: input.country ?? null,
        now,
      });

      await deps.watchlistEntryRepository.create(entry, tx);
      await deps.indexWatchlistEntry({ entryId: entry.id, tx });

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'CREATE_WATCHLIST_ENTRY',
          resource: 'watchlist_entry',
          resourceId: String(entry.id),
          detail: { watchlistId: String(watchlistId), name: entry.name, entryType: entry.entryType },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return entry;
    });
  };
}
