import type { Clock } from '../../../shared/time/Clock.js';
import type { Watchlist } from '../domain/model/aggregates/Watchlist.js';
import { Watchlist as WatchlistAggregate } from '../domain/model/aggregates/Watchlist.js';
import type { RiskLevel } from '../domain/model/value-objects/RiskLevel.js';
import type { SanctionSource } from '../domain/model/value-objects/SanctionSource.js';
import { SANCTION_WATCHLIST_NAMES } from '../domain/model/value-objects/SanctionSource.js';
import type { WatchlistEntryId } from '../domain/model/value-objects/WatchlistEntryId.js';
import type { WatchlistId } from '../domain/model/value-objects/WatchlistId.js';
import type { ActiveOrganizationSource } from '../domain/ports/ActiveOrganizationSource.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { NameNormalizer } from '../domain/ports/NameNormalizer.js';
import type { PhoneticEncoder } from '../domain/ports/PhoneticEncoder.js';
import type { SanctionListFeed } from '../domain/ports/SanctionListFeed.js';
import type {
  SanctionListRecord,
  SyncedEntryWrite,
  SyncedWatchlistEntryStore,
} from '../domain/ports/SyncedWatchlistEntryStore.js';
import type { WatchlistRepository } from '../domain/ports/WatchlistRepository.js';
import { computeIndexedNameFields } from '../domain/services/IndexedNameFields.js';
import type { SyncRefusal, WatchlistSyncPlan } from '../domain/services/WatchlistSyncPlan.js';
import {
  expandSanctionedParty,
  fingerprintRecord,
  planWatchlistSync,
  refuseUnsafeSync,
} from '../domain/services/WatchlistSyncPlan.js';

/**
 * Every entry of an official sanctions list is CRITICAL. A match against
 * one is a legal prohibition, not a risk opinion, and `riskLevel` feeds the
 * alert severity calculator — anything lower would let a sanctions hit sort
 * below an internal watchlist hit in the AML inbox.
 */
export const SANCTION_ENTRY_RISK_LEVEL: RiskLevel = 'CRITICAL';

export interface SyncSanctionWatchlistsDeps {
  readonly feeds: readonly SanctionListFeed[];
  readonly organizations: ActiveOrganizationSource;
  readonly watchlistRepository: WatchlistRepository;
  readonly store: SyncedWatchlistEntryStore;
  readonly nameNormalizer: NameNormalizer;
  readonly phoneticEncoder: PhoneticEncoder;
  readonly auditRecorder: AuditRecorder;
  readonly clock: Clock;
  readonly generateWatchlistId: () => WatchlistId;
  readonly generateWatchlistEntryId: () => WatchlistEntryId;
}

/** `NAME_TAKEN`: the organization owns a watchlist with the reserved name that this sync did not create. */
export type OrganizationSyncRefusal = SyncRefusal | 'NAME_TAKEN';

export interface OrganizationSyncOutcome {
  readonly organizationId: string;
  readonly watchlistId: string | null;
  /** Planned counts. When `refused` is set, NOTHING was applied. */
  readonly inserted: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly refused: OrganizationSyncRefusal | null;
  readonly error: string | null;
}

export interface SanctionSyncOutcome {
  readonly source: SanctionSource;
  readonly parties: number;
  readonly records: number;
  readonly organizations: readonly OrganizationSyncOutcome[];
  readonly error: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resolveWatchlist(
  deps: SyncSanctionWatchlistsDeps,
  source: SanctionSource,
  organizationId: string,
): Promise<Watchlist | null> {
  const name = SANCTION_WATCHLIST_NAMES[source];
  const existing = await deps.watchlistRepository.findByNameForOrg(organizationId, name);
  if (existing !== null) return existing.source === source ? existing : null;

  const created = WatchlistAggregate.create({
    id: deps.generateWatchlistId(),
    organizationId,
    name,
    source,
    type: 'BLACKLIST',
    description: 'Kept in sync with the official publication every night. Manual edits are overwritten.',
    now: deps.clock.now(),
  });
  await deps.watchlistRepository.create(created);
  return created;
}

async function applyPlan(
  deps: SyncSanctionWatchlistsDeps,
  watchlist: Watchlist,
  plan: WatchlistSyncPlan,
): Promise<void> {
  const write = (id: WatchlistEntryId, record: SanctionListRecord): SyncedEntryWrite => ({
    id,
    record,
    fingerprint: fingerprintRecord(record),
    indexed: computeIndexedNameFields(record.name, deps.nameNormalizer, deps.phoneticEncoder),
  });
  await deps.store.apply({
    watchlistId: watchlist.id,
    organizationId: watchlist.organizationId,
    riskLevel: SANCTION_ENTRY_RISK_LEVEL,
    inserts: plan.inserts.map((record) => write(deps.generateWatchlistEntryId(), record)),
    updates: plan.updates.map((update) => write(update.id, update.record)),
    removals: plan.removals,
    now: deps.clock.now(),
  });
}

/**
 * One audit row per organization and list, every night, even when nothing
 * changed. "The list was checked on this date and was current" is itself the
 * evidence an examiner asks for; silence on quiet nights would read as the
 * job not running.
 */
async function audit(
  deps: SyncSanctionWatchlistsDeps,
  source: SanctionSource,
  outcome: OrganizationSyncOutcome,
): Promise<void> {
  await deps.auditRecorder.record({
    organizationId: outcome.organizationId,
    actorType: 'PLATFORM_ADMIN',
    actorId: null,
    action: 'SYNC_SANCTION_WATCHLIST',
    resource: 'watchlist',
    resourceId: outcome.watchlistId,
    detail: {
      source,
      inserted: outcome.inserted,
      updated: outcome.updated,
      removed: outcome.removed,
      unchanged: outcome.unchanged,
      refused: outcome.refused,
    },
    ipAddress: null,
  });
}

async function syncOrganization(
  deps: SyncSanctionWatchlistsDeps,
  source: SanctionSource,
  organizationId: string,
  records: readonly SanctionListRecord[],
): Promise<OrganizationSyncOutcome> {
  const empty: OrganizationSyncOutcome = {
    organizationId,
    watchlistId: null,
    inserted: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    refused: null,
    error: null,
  };
  try {
    const watchlist = await resolveWatchlist(deps, source, organizationId);
    if (watchlist === null) return { ...empty, refused: 'NAME_TAKEN' };

    const existing = await deps.store.listSnapshots(watchlist.id);
    const plan = planWatchlistSync(existing, records);
    const refused = refuseUnsafeSync(plan, records.length, existing);
    if (refused === null) await applyPlan(deps, watchlist, plan);

    const outcome: OrganizationSyncOutcome = {
      ...empty,
      watchlistId: String(watchlist.id),
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      removed: plan.removals.length,
      unchanged: plan.unchanged,
      refused,
    };
    await audit(deps, source, outcome);
    return outcome;
  } catch (error) {
    return { ...empty, error: errorMessage(error) };
  }
}

async function syncFeed(
  deps: SyncSanctionWatchlistsDeps,
  feed: SanctionListFeed,
  organizationIds: readonly string[],
): Promise<SanctionSyncOutcome> {
  let parties;
  try {
    parties = await feed.fetchParties();
  } catch (error) {
    return { source: feed.source, parties: 0, records: 0, organizations: [], error: errorMessage(error) };
  }
  const records = parties.flatMap(expandSanctionedParty);
  const organizations: OrganizationSyncOutcome[] = [];
  for (const organizationId of organizationIds) {
    organizations.push(await syncOrganization(deps, feed.source, organizationId, records));
  }
  return { source: feed.source, parties: parties.length, records: records.length, organizations, error: null };
}

function describeProblems(outcomes: readonly SanctionSyncOutcome[]): string[] {
  return outcomes.flatMap((outcome) => {
    if (outcome.error !== null) return [`${outcome.source}: ${outcome.error}`];
    return outcome.organizations
      .filter((organization) => organization.refused !== null || organization.error !== null)
      .map(
        (organization) =>
          `${outcome.source} in organization ${organization.organizationId}: ${organization.refused ?? organization.error}`,
      );
  });
}

/**
 * AML-001: materializes each official sanctions list into every active
 * organization as a BLACKLIST watchlist, and keeps it current.
 *
 * Each list is downloaded once per run and applied to every organization.
 * One failing list or organization never blocks the others; the run still
 * THROWS at the end when anything failed or was refused, so the
 * scheduled-jobs catalog records FAILED and someone looks — a sanctions list
 * that silently stopped updating is the failure this job exists to prevent.
 *
 * New or changed WALLET entries get a fresh `updated_at`, so the next
 * wallet rescreen picks them up through its existing delta scan.
 */
export function createSyncSanctionWatchlistsUseCase(deps: SyncSanctionWatchlistsDeps) {
  return async function syncSanctionWatchlists(): Promise<readonly SanctionSyncOutcome[]> {
    const organizationIds = await deps.organizations.listActiveOrganizationIds();
    const outcomes: SanctionSyncOutcome[] = [];
    for (const feed of deps.feeds) {
      outcomes.push(await syncFeed(deps, feed, organizationIds));
    }
    const problems = describeProblems(outcomes);
    if (problems.length > 0) {
      throw new Error(`sanctions list sync incomplete: ${problems.join('; ')}`);
    }
    return outcomes;
  };
}
