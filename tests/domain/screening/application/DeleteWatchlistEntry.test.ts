import { oid } from '../../../support/oid.js';
import { createDeleteWatchlistEntryUseCase } from '../../../../src/modules/screening/application/DeleteWatchlistEntry.js';
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
  const deleteWatchlistEntry = createDeleteWatchlistEntryUseCase({
    watchlistEntryRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
  });
  return { watchlistEntryRepository, auditRecorder, deleteWatchlistEntry };
}

function createEntry(orgId: string) {
  return WatchlistEntry.create({
    id: createWatchlistEntryId(oid('entry-1')),
    watchlistId: createWatchlistId(oid('watchlist-1')),
    organizationId: orgId,
    entryType: 'PERSON',
    name: 'Jane Doe',
    now: NOW,
  });
}

describe('createDeleteWatchlistEntryUseCase', () => {
  it('soft-deletes entry to REMOVED and writes one audit row', async () => {
    const { watchlistEntryRepository, auditRecorder, deleteWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    const deleted = await deleteWatchlistEntry({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      entryId: oid('entry-1'),
    });

    expect(deleted.status).toBe('REMOVED');
    expect(deleted.deletedAt).toBe(NOW);
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({ action: 'DELETE_WATCHLIST_ENTRY', resource: 'watchlist_entry' });
  });

  it('rejects deletion of a cross-tenant entry with WATCHLIST_ENTRY_NOT_FOUND', async () => {
    const { watchlistEntryRepository, deleteWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_2));

    await expect(
      deleteWatchlistEntry({ auth: ANALYST, watchlistId: oid('watchlist-1'), entryId: oid('entry-1') }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_ENTRY_NOT_FOUND' });
  });

  it('is idempotent: already-REMOVED entry still returns deleted state with no extra audit row', async () => {
    const { watchlistEntryRepository, auditRecorder, deleteWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    await deleteWatchlistEntry({ auth: ANALYST, watchlistId: oid('watchlist-1'), entryId: oid('entry-1') });
    const retried = await deleteWatchlistEntry({
      auth: ANALYST,
      watchlistId: oid('watchlist-1'),
      entryId: oid('entry-1'),
    });

    expect(retried.status).toBe('REMOVED');
    expect(auditRecorder.events).toHaveLength(1);
  });

  it('rejects deletion when the parent watchlist id does not match the entry', async () => {
    const { watchlistEntryRepository, deleteWatchlistEntry } = buildUseCase();
    await watchlistEntryRepository.create(createEntry(ORG_1));

    await expect(
      deleteWatchlistEntry({
        auth: ANALYST,
        watchlistId: oid('watchlist-other'),
        entryId: oid('entry-1'),
      }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_ENTRY_NOT_FOUND' });
  });
});
