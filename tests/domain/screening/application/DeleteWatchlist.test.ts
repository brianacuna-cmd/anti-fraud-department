import { oid } from '../../../support/oid.js';
import { createDeleteWatchlistUseCase } from '../../../../src/modules/screening/application/DeleteWatchlist.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

function buildUseCase() {
  const watchlistRepository = new InMemoryWatchlistRepository();
  const watchlistEntryRepository = new InMemoryWatchlistEntryRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const deleteWatchlist = createDeleteWatchlistUseCase({
    watchlistRepository,
    watchlistEntryRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { watchlistRepository, watchlistEntryRepository, auditRecorder, deleteWatchlist };
}

describe('createDeleteWatchlistUseCase', () => {
  it('soft-deletes the watchlist, cascades entries to REMOVED, and writes exactly one audit row', async () => {
    const { watchlistRepository, watchlistEntryRepository, auditRecorder, deleteWatchlist } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    await watchlistRepository.create(
      Watchlist.create({
        id: watchlistId,
        organizationId: ORG_1,
        name: 'OFAC List',
        source: 'OFAC',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );
    for (let i = 0; i < 5; i += 1) {
      watchlistEntryRepository.seed({
        id: createWatchlistEntryId(oid(`entry-${i}`)),
        watchlistId,
        name: `Entry ${i}`,
        status: 'ACTIVE',
        deletedAt: null,
      });
    }

    const deleted = await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') });

    expect(deleted.status).toBe('INACTIVE');
    expect(deleted.deletedAt).toBe(NOW);
    expect(watchlistEntryRepository.all().every((e) => e.status === 'REMOVED')).toBe(true);
    expect(watchlistEntryRepository.all()).toHaveLength(5);
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({ action: 'DELETE_WATCHLIST', resource: 'watchlist' });
  });

  it('rejects a cross-tenant delete', async () => {
    const { watchlistRepository, deleteWatchlist } = buildUseCase();
    await watchlistRepository.create(
      Watchlist.create({
        id: createWatchlistId(oid('watchlist-1')),
        organizationId: ORG_2,
        name: 'OFAC List',
        source: 'OFAC',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    await expect(
      deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });
  });

  it('is idempotent for an already-deleted watchlist (no-op, no extra audit row)', async () => {
    const { watchlistRepository, auditRecorder, deleteWatchlist } = buildUseCase();
    await watchlistRepository.create(
      Watchlist.create({
        id: createWatchlistId(oid('watchlist-1')),
        organizationId: ORG_1,
        name: 'OFAC List',
        source: 'OFAC',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    const first = await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') });
    const second = await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') });

    expect(first.status).toBe('INACTIVE');
    expect(second.status).toBe('INACTIVE');
    expect(auditRecorder.events).toHaveLength(1);
  });
});
