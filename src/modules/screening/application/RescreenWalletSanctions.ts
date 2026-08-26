import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import type { WatchlistEntryRepository, WalletEntryDeltaQuery } from '../domain/ports/WatchlistEntryRepository.js';
import type { ScreeningWatermarkRepository } from '../domain/ports/ScreeningWatermarkRepository.js';
import type { FinturuWalletSource } from '../domain/ports/FinturuWalletSource.js';
import type { WalletRescreenCaseLinker } from '../domain/ports/WalletRescreenCaseLinker.js';
import type { AmlAlertRepository } from '../domain/ports/AmlAlertRepository.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { OpenAmlAlertInput, OpenAmlAlertResult } from './OpenAmlAlert.js';
import type { WatchlistEntry } from '../domain/model/aggregates/WatchlistEntry.js';
import type { WatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import type { Instant } from '../../../shared/time/Instant.js';
import { createMatchScore } from '../domain/model/value-objects/MatchScore.js';
import { createMatchField } from '../domain/model/value-objects/MatchField.js';
import { createScreeningMatch } from '../domain/model/entities/ScreeningMatch.js';

const WALLET_RESCREEN_JOB = 'wallet-rescreen';
const PAGE_SIZE = 100;
const HOLDER_BATCH_SIZE = 100;

export interface RescreenWalletSanctionsInput {
  readonly auth: AuthContext;
}

export interface RescreenWalletSanctionsDeps {
  readonly clock: Clock;
  readonly watchlistRepository: WatchlistRepository;
  readonly watchlistEntryRepository: WatchlistEntryRepository;
  readonly watermarkRepository: ScreeningWatermarkRepository;
  readonly walletSource: FinturuWalletSource;
  readonly openAmlAlert: (input: OpenAmlAlertInput) => Promise<OpenAmlAlertResult>;
  readonly amlAlertRepository: AmlAlertRepository;
  readonly unitOfWork: UnitOfWork;
  readonly isOrganizationActive: (organizationId: string) => Promise<boolean>;
  readonly caseLinker?: WalletRescreenCaseLinker;
  readonly backfill?: boolean;
}

async function collectBlacklistIds(
  deps: RescreenWalletSanctionsDeps,
  organizationId: string,
): Promise<WatchlistId[]> {
  const ids: WatchlistId[] = [];
  let offset = 0;
  while (true) {
    const page = await deps.watchlistRepository.list({
      organizationId,
      type: ['BLACKLIST'],
      status: ['ACTIVE'],
      limit: PAGE_SIZE,
      offset,
    });
    for (const w of page.items) ids.push(w.id);
    if (page.items.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return ids;
}

async function collectDelta(
  deps: RescreenWalletSanctionsDeps,
  organizationId: string,
  watchlistIds: WatchlistId[],
  since: Instant | null,
): Promise<WatchlistEntry[]> {
  const entries: WatchlistEntry[] = [];
  const baseQuery: Omit<WalletEntryDeltaQuery, 'after'> = {
    organizationId,
    watchlistIds,
    updatedSince: since,
    limit: PAGE_SIZE,
  };
  let after: WalletEntryDeltaQuery['after'];
  while (true) {
    const page = await deps.watchlistEntryRepository.listActiveWalletEntriesUpdatedSince(
      after ? { ...baseQuery, after } : baseQuery,
    );
    entries.push(...page);
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1]!;
    after = { updatedAt: last.updatedAt, id: last.id };
  }
  return entries;
}

async function maybeLink(
  deps: RescreenWalletSanctionsDeps,
  result: OpenAmlAlertResult,
  organizationId: string,
  customerId: string,
): Promise<void> {
  if (!result.opened || result.alert === null || deps.caseLinker === undefined) return;
  const caseId = await deps.caseLinker.find(organizationId, customerId);
  if (caseId === null) return;
  const linked = result.alert.linkCase(caseId, deps.clock.now());
  await deps.unitOfWork.withTransaction(async (tx) => {
    await deps.amlAlertRepository.save(linked, tx);
  });
}

async function matchAndAlert(
  deps: RescreenWalletSanctionsDeps,
  auth: AuthContext,
  organizationId: string,
  entries: WatchlistEntry[],
): Promise<void> {
  for await (const holder of deps.walletSource.streamHolders(HOLDER_BATCH_SIZE)) {
    for (const entry of entries) {
      const rawAddr = entry.walletAddress;
      if (rawAddr === null || rawAddr.trim().length === 0) continue;
      const normalizedEntry = rawAddr.trim().toLowerCase();
      const matched = holder.walletAddresses.some((a) => a.trim().toLowerCase() === normalizedEntry);
      if (!matched) continue;
      const match = createScreeningMatch({
        entryId: entry.id,
        watchlistId: entry.watchlistId,
        name: entry.name,
        document: entry.document,
        riskLevel: entry.riskLevel,
        matchField: createMatchField('WALLET'),
        algorithm: 'EXACT',
      });
      const result = await deps.openAmlAlert({
        auth,
        customerId: holder.customerId,
        match,
        confidence: createMatchScore(100),
      });
      await maybeLink(deps, result, organizationId, holder.customerId);
    }
  }
}

/**
 * Delta-rescreen use case: compares newly added BLACKLIST WALLET entries
 * against all active Finturu wallet holders and emits idempotent AML alerts.
 * Advances a durable watermark after each successful scan so only new delta
 * entries are processed on the next run. Never auto-creates fraud cases.
 */
export function createRescreenWalletSanctionsUseCase(deps: RescreenWalletSanctionsDeps) {
  return async function rescreenWalletSanctions(input: RescreenWalletSanctionsInput): Promise<void> {
    // R2: org precondition — missing org exits with no side effects
    const organizationId = input.auth.organizationId;
    if (organizationId === null) return;

    const isActive = await deps.isOrganizationActive(organizationId);
    if (!isActive) return;

    // R6: read watermark
    const watermark = await deps.watermarkRepository.read(organizationId, WALLET_RESCREEN_JOB);

    // R6: first run, no backfill → seed watermark to now, skip historical scan
    if (watermark === null && !deps.backfill) {
      await deps.watermarkRepository.advance(organizationId, WALLET_RESCREEN_JOB, deps.clock.now());
      return;
    }

    // D1, R3: two-step delta resolution
    const watchlistIds = await collectBlacklistIds(deps, organizationId);
    if (watchlistIds.length === 0) {
      await deps.watermarkRepository.advance(organizationId, WALLET_RESCREEN_JOB, deps.clock.now());
      return;
    }

    // null → epoch backfill (WALLET_RESCREEN_BACKFILL=true first run)
    const entries = await collectDelta(deps, organizationId, watchlistIds, watermark);
    if (entries.length === 0) {
      await deps.watermarkRepository.advance(organizationId, WALLET_RESCREEN_JOB, deps.clock.now());
      return;
    }

    // R4, R5: exact match → alert → optional case link
    await matchAndAlert(deps, input.auth, organizationId, entries);

    // R6: advance watermark to max(updated_at) of scanned entries (D2)
    const maxUpdatedAt = entries.reduce<Instant>(
      (m, e) => ((e.updatedAt as string) > (m as string) ? e.updatedAt : m),
      entries[0]!.updatedAt,
    );
    await deps.watermarkRepository.advance(organizationId, WALLET_RESCREEN_JOB, maxUpdatedAt);
  };
}
