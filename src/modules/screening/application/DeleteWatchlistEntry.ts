import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { WatchlistEntry } from '../domain/model/aggregates/WatchlistEntry.js';
import type { WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createWatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistEntryNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface DeleteWatchlistEntryInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
  readonly entryId: string;
}

export interface DeleteWatchlistEntryDeps {
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * RF-9: soft-delete an entry (status -> REMOVED + deletedAt). Idempotent:
 * if already REMOVED, returns the existing entry and writes no extra audit
 * row. No re-index is required (matcher filters on status ACTIVE).
 * `findById` is org-blind — org check is done here (mirrors DeleteWatchlist).
 */
export function createDeleteWatchlistEntryUseCase(deps: DeleteWatchlistEntryDeps) {
  return async function deleteWatchlistEntry(input: DeleteWatchlistEntryInput): Promise<WatchlistEntry> {
    const organizationId = requireTenantContext(input.auth);
    const entryId = createWatchlistEntryId(input.entryId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const watchlistId = createWatchlistId(input.watchlistId);
      const existing = await deps.watchlistEntryRepository.findById(entryId, tx);
      if (existing === null || existing.organizationId !== organizationId || existing.watchlistId !== watchlistId) {
        throw watchlistEntryNotFound(input.entryId);
      }

      const alreadyRemoved = existing.status === 'REMOVED' && existing.deletedAt !== null;
      const deleted = alreadyRemoved ? existing : existing.softDelete(deps.clock.now());

      if (!alreadyRemoved) {
        await deps.watchlistEntryRepository.save(deleted, tx);

        await deps.auditRecorder.record(
          {
            organizationId,
            actorType: input.auth.actorType,
            actorId: input.auth.userId,
            action: 'DELETE_WATCHLIST_ENTRY',
            resource: 'watchlist_entry',
            resourceId: String(deleted.id),
            detail: { name: deleted.name, watchlistId: String(deleted.watchlistId) },
            ipAddress: input.auth.ipAddress,
          },
          tx,
        );
      }

      return deleted;
    });
  };
}
