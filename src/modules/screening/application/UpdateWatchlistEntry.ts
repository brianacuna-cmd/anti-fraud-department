import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { WatchlistEntry } from '../domain/model/aggregates/WatchlistEntry.js';
import type { EntryType } from '../domain/model/value-objects/EntryType.js';
import type { RiskLevel } from '../domain/model/value-objects/RiskLevel.js';
import type { WatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import { createWatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistEntryNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface UpdateWatchlistEntryInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
  readonly entryId: string;
  readonly name?: string;
  readonly document?: string | null;
  readonly walletAddress?: string | null;
  readonly riskLevel?: RiskLevel | null;
  readonly country?: string | null;
  readonly entryType?: EntryType;
}

export interface UpdateWatchlistEntryDeps {
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly indexWatchlistEntry: (input: { entryId: WatchlistEntryId; tx?: Transaction }) => Promise<void>;
}

/**
 * RF-8: patch fields of an entry belonging to the caller's org, atomic
 * write+audit in one tx. Re-indexes ONLY when the `name` changes (ADR-3).
 * `findById` is org-blind — the use case performs the org check itself
 * (mirrors `UpdateWatchlist` / `GetWatchlist` design).
 */
export function createUpdateWatchlistEntryUseCase(deps: UpdateWatchlistEntryDeps) {
  return async function updateWatchlistEntry(input: UpdateWatchlistEntryInput): Promise<WatchlistEntry> {
    const organizationId = requireTenantContext(input.auth);
    const entryId = createWatchlistEntryId(input.entryId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const watchlistId = createWatchlistId(input.watchlistId);
      const existing = await deps.watchlistEntryRepository.findById(entryId, tx);
      if (
        existing === null ||
        existing.organizationId !== organizationId ||
        existing.watchlistId !== watchlistId ||
        existing.status === 'REMOVED'
      ) {
        throw watchlistEntryNotFound(input.entryId);
      }

      const now = deps.clock.now();
      const nameChanging = input.name !== undefined && input.name !== existing.name;
      const updated = existing.update(
        {
          name: input.name,
          document: input.document,
          walletAddress: input.walletAddress,
          riskLevel: input.riskLevel,
          country: input.country,
          entryType: input.entryType,
        },
        now,
      );
      await deps.watchlistEntryRepository.save(updated, tx);

      if (nameChanging) {
        await deps.indexWatchlistEntry({ entryId: updated.id, tx });
      }

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_WATCHLIST_ENTRY',
          resource: 'watchlist_entry',
          resourceId: String(updated.id),
          detail: { name: updated.name, riskLevel: updated.riskLevel, entryType: updated.entryType },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
