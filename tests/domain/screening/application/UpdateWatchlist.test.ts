import { oid } from '../../../support/oid.js';
import { createUpdateWatchlistUseCase } from '../../../../src/modules/screening/application/UpdateWatchlist.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
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
  const auditRecorder = new RecordingAuditRecorder();
  const updateWatchlist = createUpdateWatchlistUseCase({
    watchlistRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { watchlistRepository, auditRecorder, updateWatchlist };
}

describe('createUpdateWatchlistUseCase', () => {
  it('updates a same-org watchlist and writes one audit row', async () => {
    const { watchlistRepository, auditRecorder, updateWatchlist } = buildUseCase();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_1,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    const updated = await updateWatchlist({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      description: 'Updated description',
    });

    expect(updated.description).toBe('Updated description');
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({ action: 'UPDATE_WATCHLIST', resource: 'watchlist' });
  });

  it('rejects a cross-tenant update with no changes/audit made', async () => {
    const { watchlistRepository, auditRecorder, updateWatchlist } = buildUseCase();
    const watchlist = Watchlist.create({
      id: createWatchlistId(oid('watchlist-1')),
      organizationId: ORG_2,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    });
    await watchlistRepository.create(watchlist);

    await expect(
      updateWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-1'), description: 'x' }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });

    expect(auditRecorder.events).toHaveLength(0);
    const stored = await watchlistRepository.findById(createWatchlistId(oid('watchlist-1')));
    expect(stored?.description).toBeNull();
  });

  it('rejects renaming to a name already used by another watchlist in the same org', async () => {
    const { watchlistRepository, updateWatchlist } = buildUseCase();
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
    await watchlistRepository.create(
      Watchlist.create({
        id: createWatchlistId(oid('watchlist-2')),
        organizationId: ORG_1,
        name: 'EU List',
        source: 'EU',
        type: 'BLACKLIST',
        now: NOW,
      }),
    );

    await expect(
      updateWatchlist({ auth: ANALYST, watchlistId: oid('watchlist-2'), name: 'OFAC List' }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NAME_TAKEN' });
  });
});
