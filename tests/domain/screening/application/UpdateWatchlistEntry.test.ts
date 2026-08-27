import { oid } from '../../../support/oid.js';
import { createUpdateWatchlistEntryUseCase } from '../../../../src/modules/screening/application/UpdateWatchlistEntry.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { createWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { AuditEvent, AuditRecorder } from '../../../../src/modules/screening/domain/ports/AuditRecorder.js';
import type { Transaction } from '../../../../src/modules/screening/domain/ports/UnitOfWork.js';
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
  const watchlistEntryRepository = new InMemoryWatchlistEntryRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const reindexCalls: string[] = [];
  const indexWatchlistEntry = async ({ entryId }: { entryId: unknown; tx?: unknown }): Promise<void> => {
    reindexCalls.push(String(entryId));
  };
  const updateWatchlistEntry = createUpdateWatchlistEntryUseCase({
    watchlistEntryRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    indexWatchlistEntry,
  });
  return { watchlistEntryRepository, auditRecorder, reindexCalls, updateWatchlistEntry };
}

function createEntry(orgId: string) {
  return WatchlistEntry.create({
    id: createWatchlistEntryId(oid('entry-1')),
    watchlistId: createWatchlistId(oid('watchlist-1')),
    organizationId: orgId,
    entryType: 'PERSON',
    name: 'Jon Smith',
    now: NOW,
  });
}

describe('createUpdateWatchlistEntryUseCase', () => {
  it('updates a non-name field and writes one audit row without re-indexing', async () => {
    const { watchlistEntryRepository, auditRecorder, reindexCalls, updateWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    const updated = await updateWatchlistEntry({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      entryId: oid('entry-1'),
      riskLevel: 'HIGH',
    });

    expect(updated.riskLevel).toBe('HIGH');
    expect(reindexCalls).toHaveLength(0);
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({ action: 'UPDATE_WATCHLIST_ENTRY', resource: 'watchlist_entry' });
  });

  it('re-indexes when the entry name changes', async () => {
    const { watchlistEntryRepository, reindexCalls, updateWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    await updateWatchlistEntry({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      entryId: oid('entry-1'),
      name: 'John Smithe',
    });

    expect(reindexCalls).toHaveLength(1);
  });

  it('rejects update of a cross-tenant entry with WATCHLIST_ENTRY_NOT_FOUND', async () => {
    const { watchlistEntryRepository, updateWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_2));

    await expect(
      updateWatchlistEntry({ auth: ANALYST, watchlistId: oid('watchlist-1'), entryId: oid('entry-1'), riskLevel: 'LOW' }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_ENTRY_NOT_FOUND' });
  });

  it('rejects update when the parent watchlist id does not match the entry', async () => {
    const { watchlistEntryRepository, updateWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    await expect(
      updateWatchlistEntry({
        auth: ANALYST,
        watchlistId: oid('watchlist-other'),
        entryId: oid('entry-1'),
        riskLevel: 'HIGH',
      }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_ENTRY_NOT_FOUND' });
  });

  it('rejects update of a REMOVED entry with WATCHLIST_ENTRY_NOT_FOUND', async () => {
    const { watchlistEntryRepository, updateWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1).softDelete(NOW));

    await expect(
      updateWatchlistEntry({
        auth: ANALYST,
        watchlistId: oid('watchlist-1'),
        entryId: oid('entry-1'),
        riskLevel: 'HIGH',
      }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_ENTRY_NOT_FOUND' });
  });

  it('does not re-index when the submitted name is unchanged', async () => {
    const { watchlistEntryRepository, reindexCalls, updateWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    await updateWatchlistEntry({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      entryId: oid('entry-1'),
      name: 'Jon Smith',
    });

    expect(reindexCalls).toHaveLength(0);
  });
});
