import { oid } from '../../../support/oid.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { InMemoryWatchlistRepository } from '../../../helpers/screening/InMemoryWatchlistRepository.js';
import { InMemoryWatchlistEntryRepository } from '../../../helpers/screening/InMemoryWatchlistEntryRepository.js';
import { InMemoryAmlAlertRepository } from '../../../helpers/screening/InMemoryAmlAlertRepository.js';
import { InMemoryAmlAlertTimelineRecorder } from '../../../helpers/screening/InMemoryAmlAlertTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/screening/infrastructure/PassthroughUnitOfWork.js';
import { createOpenAmlAlertUseCase } from '../../../../src/modules/screening/application/OpenAmlAlert.js';
import { generateAmlAlertId } from '../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { generateObjectIdHex } from '../../../../src/shared/kernel/ObjectIdHex.js';
import { Watchlist } from '../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { createRescreenWalletSanctionsUseCase } from '../../../../src/modules/screening/application/RescreenWalletSanctions.js';
import type { FinturuWalletHolder, FinturuWalletSource } from '../../../../src/modules/screening/domain/ports/FinturuWalletSource.js';
import type { ScreeningWatermarkRepository } from '../../../../src/modules/screening/domain/ports/ScreeningWatermarkRepository.js';
import type { Instant } from '../../../../src/shared/time/Instant.js';

const ORG = oid('org-1');
const CID = oid('customer-1');
const NOW = fromDate(new Date('2026-01-01T10:00:00.000Z'));
const WM  = fromDate(new Date('2026-01-01T09:00:00.000Z'));
const T1  = fromDate(new Date('2026-01-01T09:30:00.000Z'));
const T2  = fromDate(new Date('2026-01-01T09:45:00.000Z'));
const AUTH = createAuthContext({ userId: 'system:wallet-rescreen', organizationId: ORG, actorType: 'ORGANIZATION' });

class FakeWatermark implements ScreeningWatermarkRepository {
  readonly store = new Map<string, Instant>();
  async read(o: string, j: string): Promise<Instant | null> { return this.store.get(`${o}:${j}`) ?? null; }
  async advance(o: string, j: string, ts: Instant): Promise<void> { this.store.set(`${o}:${j}`, ts); }
  get(o = ORG, j = 'wallet-rescreen'): Instant | null { return this.store.get(`${o}:${j}`) ?? null; }
  seed(ts: Instant, o = ORG, j = 'wallet-rescreen'): void { this.store.set(`${o}:${j}`, ts); }
}
const seededWm = (ts = WM) => { const wm = new FakeWatermark(); wm.seed(ts); return wm; };

function holderSource(holders: FinturuWalletHolder[]): FinturuWalletSource {
  return { async *streamHolders() { yield* holders; } };
}

const mkWl = (org = ORG) =>
  Watchlist.create({ id: generateWatchlistId(), organizationId: org, name: 'OFAC', source: 'OFAC', type: 'BLACKLIST', now: NOW });

const mkEntry = (wlId: ReturnType<typeof generateWatchlistId>, addr: string, updatedAt: Instant = T1) =>
  WatchlistEntry.rehydrate({
    id: generateWatchlistEntryId(), watchlistId: wlId, organizationId: ORG,
    entryType: 'WALLET', name: 'Sanctioned Entity', document: null, walletAddress: addr,
    riskLevel: 'HIGH', country: null, status: 'ACTIVE', deletedAt: null, createdAt: WM, updatedAt,
  });

function build(opts: {
  isActive?: (id: string) => Promise<boolean>;
  walletSource?: FinturuWalletSource;
  wm?: FakeWatermark;
  caseLinker?: { find: jest.Mock };
  backfill?: boolean;
} = {}) {
  const alertRepo = new InMemoryAmlAlertRepository();
  const clock = new FixedClock(NOW);
  const openAmlAlert = createOpenAmlAlertUseCase({
    amlAlertRepository: alertRepo, timelineRecorder: new InMemoryAmlAlertTimelineRecorder(),
    outbox: new InMemoryOutboxEventRepository(), unitOfWork: new PassthroughUnitOfWork(), clock,
    generateAmlAlertId, generateTimelineEventId: generateObjectIdHex, generateOutboxEventId,
  });
  const wm = opts.wm ?? new FakeWatermark();
  const wlRepo = new InMemoryWatchlistRepository();
  const entryRepo = new InMemoryWatchlistEntryRepository();
  const useCase = createRescreenWalletSanctionsUseCase({
    clock, watchlistRepository: wlRepo, watchlistEntryRepository: entryRepo,
    watermarkRepository: wm, walletSource: opts.walletSource ?? holderSource([]),
    openAmlAlert, amlAlertRepository: alertRepo, unitOfWork: new PassthroughUnitOfWork(),
    isOrganizationActive: opts.isActive ?? (() => Promise.resolve(true)),
    caseLinker: opts.caseLinker, backfill: opts.backfill,
  });
  return { useCase, wlRepo, entryRepo, wm, alertRepo };
}

async function seedMatch(deps: ReturnType<typeof build>, addr = '0xabc', updatedAt = T1) {
  const wl = mkWl();
  await deps.wlRepo.create(wl);
  await deps.entryRepo.create(mkEntry(wl.id, addr, updatedAt));
  return wl;
}

describe('3.1 — organisation precondition', () => {
  it('null organizationId exits without advancing watermark', async () => {
    const { useCase, wm } = build();
    await useCase({ auth: createAuthContext({ userId: 'system', organizationId: null, actorType: 'ORGANIZATION' }) });
    expect(wm.get()).toBeNull();
  });

  it('inactive org exits without advancing watermark or querying watchlists', async () => {
    const wm = seededWm();
    const { useCase, wlRepo } = build({ isActive: () => Promise.resolve(false), wm });
    await useCase({ auth: AUTH });
    expect(wlRepo.all()).toHaveLength(0);
    expect(wm.get()).toBe(WM);
  });
});

describe('3.2 — empty delta advances watermark to clock.now()', () => {
  it('first run, no watermark, backfill=false: advances to now without matching entries', async () => {
    const deps = build({ walletSource: holderSource([{ customerId: CID, walletAddresses: ['0xabc'] }]) });
    await seedMatch(deps);
    await deps.useCase({ auth: AUTH });
    expect(deps.wm.get()).toBe(NOW);
    expect(deps.alertRepo.all()).toHaveLength(0);
  });

  it('no BLACKLIST watchlists → advance to now', async () => {
    const { useCase, alertRepo, wm } = build({ wm: seededWm() });
    await useCase({ auth: AUTH });
    expect(wm.get()).toBe(NOW);
    expect(alertRepo.all()).toHaveLength(0);
  });

  it('BLACKLIST watchlist but no entries after watermark → advance to now', async () => {
    const { useCase, wlRepo, alertRepo, wm } = build({ wm: seededWm() });
    await wlRepo.create(mkWl());
    await useCase({ auth: AUTH });
    expect(wm.get()).toBe(NOW);
    expect(alertRepo.all()).toHaveLength(0);
  });
});

describe('3.3 — trim+lowercase exact match', () => {
  it('0xABC entry vs " 0xabc " holder emits alert confidence=100, WALLET, EXACT', async () => {
    const deps = build({ wm: seededWm(), walletSource: holderSource([{ customerId: CID, walletAddresses: [' 0xabc '] }]) });
    await seedMatch(deps, '0xABC');
    await deps.useCase({ auth: AUTH });
    const [a] = deps.alertRepo.all();
    expect(a?.confidence).toBe(100);
    expect(a?.matchedEntry.matchField).toBe('WALLET');
    expect(a?.matchedEntry.algorithm).toBe('EXACT');
    expect(a?.customerId).toBe(CID);
  });

  it('non-matching address → no alert emitted', async () => {
    const deps = build({ wm: seededWm(), walletSource: holderSource([{ customerId: CID, walletAddresses: ['0xDEF'] }]) });
    await seedMatch(deps, '0xABC');
    await deps.useCase({ auth: AUTH });
    expect(deps.alertRepo.all()).toHaveLength(0);
  });
});

describe('3.4 — natural-key idempotency', () => {
  it('duplicate run inserts exactly one alert row', async () => {
    const wm = seededWm();
    const deps = build({ wm, walletSource: holderSource([{ customerId: CID, walletAddresses: ['0xabc'] }]) });
    await seedMatch(deps);
    await deps.useCase({ auth: AUTH });
    wm.seed(WM); // reset watermark so second run re-scans same delta
    await deps.useCase({ auth: AUTH });
    expect(deps.alertRepo.all()).toHaveLength(1);
  });
});

describe('3.5 — case linking', () => {
  let linker: { find: jest.Mock };
  let deps: ReturnType<typeof build>;

  beforeEach(async () => {
    linker = { find: jest.fn() };
    deps = build({ wm: seededWm(), walletSource: holderSource([{ customerId: CID, walletAddresses: ['0xabc'] }]), caseLinker: linker });
    await seedMatch(deps);
  });

  it('caseLinker returns caseId → alert persisted with linked caseId', async () => {
    const CASE_ID = oid('case-1');
    linker.find.mockResolvedValue(CASE_ID);
    await deps.useCase({ auth: AUTH });
    expect(deps.alertRepo.all()[0]?.caseId).toBe(CASE_ID);
    expect(linker.find).toHaveBeenCalledWith(ORG, CID);
  });

  it('caseLinker returns null → no error, alert has no caseId', async () => {
    linker.find.mockResolvedValue(null);
    await expect(deps.useCase({ auth: AUTH })).resolves.not.toThrow();
    expect(deps.alertRepo.all()[0]?.caseId).toBeNull();
  });

  it('no caseLinker → link step silently skipped', async () => {
    const d = build({ wm: seededWm(), walletSource: holderSource([{ customerId: CID, walletAddresses: ['0xabc'] }]) });
    await seedMatch(d);
    await expect(d.useCase({ auth: AUTH })).resolves.not.toThrow();
  });
});

describe('3.6 — watermark = max(updated_at) after scanning entries', () => {
  it('two entries → watermark = max(updatedAt)', async () => {
    const wm = seededWm();
    const deps = build({ wm });
    const wl = mkWl(); await deps.wlRepo.create(wl);
    await deps.entryRepo.create(mkEntry(wl.id, '0xabc', T1));
    await deps.entryRepo.create(mkEntry(wl.id, '0xdef', T2));
    await deps.useCase({ auth: AUTH });
    expect(wm.get()).toBe(T2);
  });

  it('single entry → watermark = entry.updatedAt, not clock.now()', async () => {
    const wm = seededWm();
    const deps = build({ wm });
    await seedMatch(deps, '0xabc', T1);
    await deps.useCase({ auth: AUTH });
    expect(wm.get()).toBe(T1);
    expect(wm.get()).not.toBe(NOW);
  });
});
