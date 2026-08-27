import { oid } from '../../../support/oid.js';
import { createCreateWatchlistUseCase } from '../../../../src/modules/screening/application/CreateWatchlist.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
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
const OTHER_ORG_ANALYST = createAuthContext({ userId: oid('analyst-2'), organizationId: ORG_2, actorType: 'USER' });

class RecordingAuditRecorder implements AuditRecorder {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent, _tx?: Transaction): Promise<void> {
    this.events.push(event);
  }
}

function buildUseCase() {
  const watchlistRepository = new InMemoryWatchlistRepository();
  const auditRecorder = new RecordingAuditRecorder();
  const createWatchlist = createCreateWatchlistUseCase({
    watchlistRepository,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateWatchlistId,
  });
  return { watchlistRepository, auditRecorder, createWatchlist };
}

describe('createCreateWatchlistUseCase', () => {
  it('creates an ACTIVE watchlist scoped to the caller org and writes one audit row', async () => {
    const { watchlistRepository, auditRecorder, createWatchlist } = buildUseCase();

    const watchlist = await createWatchlist({
      auth: ANALYST,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
    });

    expect(watchlist.status).toBe('ACTIVE');
    expect(watchlist.organizationId).toBe(ORG_1);
    expect(watchlistRepository.all()).toHaveLength(1);
    expect(auditRecorder.events).toHaveLength(1);
    expect(auditRecorder.events[0]).toMatchObject({
      organizationId: ORG_1,
      action: 'CREATE_WATCHLIST',
      resource: 'watchlist',
    });
  });

  it('rejects a duplicate name in the same org with no watchlist/audit created', async () => {
    const { auditRecorder, createWatchlist } = buildUseCase();
    await createWatchlist({ auth: ANALYST, name: 'OFAC List', source: 'OFAC', type: 'BLACKLIST' });
    auditRecorder.events.length = 0;

    await expect(
      createWatchlist({ auth: ANALYST, name: 'OFAC List', source: 'OFAC', type: 'BLACKLIST' }),
    ).rejects.toMatchObject({ code: 'WATCHLIST_NAME_TAKEN' });

    expect(auditRecorder.events).toHaveLength(0);
  });

  it('allows the same name across different orgs', async () => {
    const { watchlistRepository, createWatchlist } = buildUseCase();
    await createWatchlist({ auth: ANALYST, name: 'OFAC List', source: 'OFAC', type: 'BLACKLIST' });

    const other = await createWatchlist({
      auth: OTHER_ORG_ANALYST,
      name: 'OFAC List',
      source: 'OFAC',
      type: 'BLACKLIST',
    });

    expect(other.organizationId).toBe(ORG_2);
    expect(watchlistRepository.all()).toHaveLength(2);
  });
});
