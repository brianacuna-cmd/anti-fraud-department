import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Watchlist } from '../domain/model/aggregates/Watchlist.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { WatchlistEntryRepository } from '../domain/ports/WatchlistEntryRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface DeleteWatchlistInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
}

export interface DeleteWatchlistDeps {
  readonly watchlistRepository: WatchlistRepository;
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * RF-5/RNF-2: soft-deletes the watchlist (status -> INACTIVE + deletedAt)
 * and, in the SAME transaction, cascade soft-deletes its entries (bulk
 * helper — full entry CRUD is Slice B). Exactly one audit row per ADR-4.
 *
 * Design decision (spec's open assumption, resolved): deleting an
 * already-deleted watchlist is IDEMPOTENT for the watchlist row and audit
 * (return the existing INACTIVE watchlist, no extra audit) rather than 404.
 * The entry cascade ALWAYS re-runs: `softDeleteAllByWatchlist` is itself
 * idempotent (only non-REMOVED rows), so a retry heals a partial delete
 * when Mongo UoW ran without a real transaction. Mirrors `DeleteUser` /
 * `TransitionUserStatus` tolerance of re-issuing the same terminal status,
 * without leaving live matches on a list operators believe was removed.
 */
export function createDeleteWatchlistUseCase(deps: DeleteWatchlistDeps) {
  return async function deleteWatchlist(input: DeleteWatchlistInput): Promise<Watchlist> {
    const organizationId = requireTenantContext(input.auth);
    const watchlistId = createWatchlistId(input.watchlistId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.watchlistRepository.findById(watchlistId, tx);
      if (existing === null || existing.organizationId !== organizationId) {
        throw watchlistNotFound(input.watchlistId);
      }

      const now = deps.clock.now();
      const alreadyDeleted = existing.status === 'INACTIVE' && existing.deletedAt !== null;
      const deleted = alreadyDeleted ? existing : existing.softDelete(now);

      if (!alreadyDeleted) {
        await deps.watchlistRepository.save(deleted, tx);
      }

      await deps.watchlistEntryRepository.softDeleteAllByWatchlist(watchlistId, now, tx);

      if (!alreadyDeleted) {
        await deps.auditRecorder.record(
          {
            organizationId,
            actorType: input.auth.actorType,
            actorId: input.auth.userId,
            action: 'DELETE_WATCHLIST',
            resource: 'watchlist',
            resourceId: String(deleted.id),
            detail: { name: deleted.name },
            ipAddress: input.auth.ipAddress,
          },
          tx,
        );
      }

      return deleted;
    });
  };
}
