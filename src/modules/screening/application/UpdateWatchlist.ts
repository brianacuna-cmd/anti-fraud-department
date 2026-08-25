import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Watchlist } from '../domain/model/aggregates/Watchlist.js';
import type { WatchlistStatus } from '../domain/model/value-objects/WatchlistStatus.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { createWatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import { watchlistNameTaken, watchlistNotFound } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface UpdateWatchlistInput {
  readonly auth: AuthContext;
  readonly watchlistId: string;
  readonly name?: string;
  readonly source?: string;
  readonly description?: string | null;
  readonly status?: WatchlistStatus;
}

export interface UpdateWatchlistDeps {
  readonly watchlistRepository: WatchlistRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * RF-4/RNF-1/RNF-2: patch fields of a same-org watchlist, re-checking name
 * uniqueness when the name changes, atomic write+audit in one tx.
 */
export function createUpdateWatchlistUseCase(deps: UpdateWatchlistDeps) {
  return async function updateWatchlist(input: UpdateWatchlistInput): Promise<Watchlist> {
    const organizationId = requireTenantContext(input.auth);
    const watchlistId = createWatchlistId(input.watchlistId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.watchlistRepository.findById(watchlistId, tx);
      if (existing === null || existing.organizationId !== organizationId) {
        throw watchlistNotFound(input.watchlistId);
      }

      if (input.name !== undefined && input.name !== existing.name) {
        const nameConflict = await deps.watchlistRepository.findByNameForOrg(organizationId, input.name, tx);
        if (nameConflict !== null) {
          throw watchlistNameTaken(input.name);
        }
      }

      const now = deps.clock.now();
      const updated = existing.update(
        {
          name: input.name,
          source: input.source,
          description: input.description,
          status: input.status,
        },
        now,
      );
      await deps.watchlistRepository.save(updated, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'UPDATE_WATCHLIST',
          resource: 'watchlist',
          resourceId: String(updated.id),
          detail: {
            name: updated.name,
            source: updated.source,
            description: updated.description,
            status: updated.status,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return updated;
    });
  };
}
