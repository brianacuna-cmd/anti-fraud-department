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
 * already-deleted watchlist is IDEMPOTENT — returns the existing
 * (already-INACTIVE) watchlist with no further cascade/audit, rather than
 * 404. Rationale: a repeated delete call is not an error condition for a
 * soft-delete-as-status-transition model (mirrors `DeleteUser`/
 * `TransitionUserStatus`'s tolerance of re-issuing the same terminal
 * status), and avoids a race where two concurrent deletes both 404.
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

      if (existing.status === 'INACTIVE' && existing.deletedAt !== null) {
        return existing;
      }

      const now = deps.clock.now();
      const deleted = existing.softDelete(now);
      await deps.watchlistRepository.save(deleted, tx);
      await deps.watchlistEntryRepository.softDeleteAllByWatchlist(watchlistId, now, tx);

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

      return deleted;
    });
  };
}
