import { oid } from '../../../support/oid.js';
import { createCreateWatchlistEntryUseCase } from '../../../../src/modules/screening/application/CreateWatchlistEntry.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
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
  const indexCalls: string[] = [];
  const indexWatchlistEntry = async ({ entryId }: { entryId: unknown; tx?: unknown }): Promise<void> => {
    indexCalls.push(String(entryId));
  };
  const createWatchlistEntry = createCreateWatchlistEntryUseCase({
    watchlistRepository,
    watchlistEntryRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateWatchlistEntryId,
    indexWatchlistEntry,
  });
  return { watchlistRepository, watchlistEntryRepository, auditRecorder, indexCalls, createWatchlistEntry };
}

describe('createCreateWatchlistEntryUseCase', () => {
  it('creates an ACTIVE entry on a same-org watchlist, indexes it, and writes one audit row', async () => {
    const { watchlistRepository, watchlistEntryRepository, auditRecorder, indexCalls, createWatchlistEntry } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_1, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW }),
    );

    const entry = await createWatchlistEntry({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      name: 'John Smith',
      entryType: 'PERSON',
    });

    expect(entry.status).toBe('ACTIVE');
    expect(entry.organizationId).toBe(ORG_1);
    expect(watchlistEntryRepository.all()).toHaveLength(1);
    expect(indexCalls).toHaveLength(1);
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({ action: 'CREATE_WATCHLIST_ENTRY', resource: 'watchlist_entry' });
  });

  it('rejects creation on a soft-deleted watchlist with WATCHLIST_NOT_FOUND', async () => {
    const { watchlistRepository, watchlistEntryRepository, auditRecorder, indexCalls, createWatchlistEntry } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    const deletedWatchlist = Watchlist.create({
      id: watchlistId,
      organizationId: ORG_1,
      name: 'OFAC',
      source: 'OFAC',
      type: 'BLACKLIST',
      now: NOW,
    }).softDelete(NOW);
    await watchlistRepository.create(deletedWatchlist);

    await expect(
      createWatchlistEntry({ auth: ANALYST, watchlistId: oid('watchlist-1'), name: 'John', entryType: 'PERSON' }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });

    expect(watchlistEntryRepository.all()).toHaveLength(0);
    expect(indexCalls).toHaveLength(0);
    expect(auditRecorder.events).toHaveLength(0);
  });

  it('rejects creation on a cross-tenant watchlist with WATCHLIST_NOT_FOUND', async () => {
    const { watchlistRepository, createWatchlistEntry } = buildUseCase();
    const watchlistId = createWatchlistId(oid('watchlist-1'));
    await watchlistRepository.create(
      Watchlist.create({ id: watchlistId, organizationId: ORG_2, name: 'EU', source: 'EU', type: 'BLACKLIST', now: NOW }),
    );

    await expect(
      createWatchlistEntry({ auth: ANALYST, watchlistId: oid('watchlist-1'), name: 'John', entryType: 'PERSON' }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NOT_FOUND' });
  });
});
