import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Watchlist } from '../domain/model/aggregates/Watchlist.js';
import type { WatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import type { WatchlistType } from '../domain/model/value-objects/WatchlistType.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { Watchlist as WatchlistAggregate } from '../domain/model/aggregates/Watchlist.js';
import { watchlistNameTaken } from '../domain/errors/ScreeningError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface CreateWatchlistInput {
  readonly auth: AuthContext;
  readonly name: string;
  readonly source: string;
  readonly type: WatchlistType;
  readonly description?: string | null;
}

export interface CreateWatchlistDeps {
  readonly watchlistRepository: WatchlistRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateWatchlistId: () => WatchlistId;
}

/**
 * RF-1: creates a `Watchlist` scoped to the caller's org. `organizationId`
 * ALWAYS comes from `requireTenantContext`, never from the body. Atomic
 * write+audit inside one `unitOfWork.withTransaction`, mirroring
 * `ResolveAmlAlert.ts:62-104`.
 */
export function createCreateWatchlistUseCase(deps: CreateWatchlistDeps) {
  return async function createWatchlist(input: CreateWatchlistInput): Promise<Watchlist> {
    const organizationId = requireTenantContext(input.auth);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.watchlistRepository.findByNameForOrg(organizationId, input.name, tx);
      if (existing !== null) {
        throw watchlistNameTaken(input.name);
      }

      const now = deps.clock.now();
      const watchlist = WatchlistAggregate.create({
        id: deps.generateWatchlistId(),
        organizationId,
        name: input.name,
        source: input.source,
        type: input.type,
        description: input.description ?? null,
        now,
      });
      await deps.watchlistRepository.create(watchlist, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'CREATE_WATCHLIST',
          resource: 'watchlist',
          resourceId: String(watchlist.id),
          detail: { name: watchlist.name, type: watchlist.type },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return watchlist;
    });
  };
}
