import { oid } from '../../../support/oid.js';
import { createDeleteWatchlistUseCase } from '../../../../src/modules/screening/application/DeleteWatchlist.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createWatchlistEntryId, generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
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

  it('is idempotent for an already-deleted watchlist (no extra audit row)', async () => {
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

  it('re-applies the entry cascade on retry when leftover entries remain ACTIVE', async () => {
    const { watchlistRepository, watchlistEntryRepository, auditRecorder, deleteWatchlist } =
      buildUseCase();
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

    await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') });
    watchlistEntryRepository.seed({
      id: createWatchlistEntryId(oid('leftover-entry')),
      watchlistId,
      name: 'Leftover',
      status: 'ACTIVE',
      deletedAt: null,
    });

    const retried = await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1') });

    expect(retried.status).toBe('INACTIVE');
    expect(watchlistEntryRepository.all().every((e) => e.status === 'REMOVED')).toBe(true);
    expect(watchlistEntryRepository.all()[0]?.deletedAt).toBe(NOW);
    expect(auditRecorder.events).toHaveLength(1);
  });

  it('cascade via real WatchlistEntry aggregates (create()) soft-deletes all to REMOVED', async () => {
    const { watchlistRepository, watchlistEntryRepository, deleteWatchlist } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-real-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'Real List', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );
    for (let i = 0; i < 3; i += 1) {
      await watchlistEntryRepository.create(
        WatchlistEntry.create({
          id: generateWatchlistEntryId(),
          watchlistId,
          organizationId: ORG_1,
          entryType: 'PERSON',
          name: `Person ${i}`,
          now: NOW,
        }),
      );
    }

    await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-real-1') });

    expect(watchlistEntryRepository.all()).toHaveLength(3);
    expect(watchlistEntryRepository.all().every((e) => e.status === 'REMOVED')).toBe(true);
  });

  it('retry with leftover ACTIVE real aggregate cascades and marks REMOVED', async () => {
    const { watchlistRepository, watchlistEntryRepository, auditRecorder, deleteWatchlist } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-real-2'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'Retry List', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );

    await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-real-2') });
    await watchlistEntryRepository.create(
      WatchlistEntry.create({
        id: generateWatchlistEntryId(),
        watchlistId,
        organizationId: ORG_1,
        entryType: 'PERSON',
        name: 'Leftover Person',
        now: NOW,
      }),
    );

    const retried = await deleteWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-real-2') });

    expect(retried.status).toBe('INACTIVE');
    expect(watchlistEntryRepository.all().every((e) => e.status === 'REMOVED')).toBe(true);
    expect(auditRecorder.events).toHaveLength(1);
  });
});
