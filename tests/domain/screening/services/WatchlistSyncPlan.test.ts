import { oid } from '../../../support/oid.js';
import { createWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import type { SanctionedParty } from '../../../../src/modules/screening/domain/ports/SanctionListFeed.js';
import type {
  SanctionListRecord,
  SyncedEntrySnapshot,
} from '../../../../src/modules/screening/domain/ports/SyncedWatchlistEntryStore.js';
import {
  MAX_REMOVAL_RATIO,
  expandSanctionedParty,
  fingerprintRecord,
  planWatchlistSync,
  refuseUnsafeSync,
} from '../../../../src/modules/screening/domain/services/WatchlistSyncPlan.js';

const party = (overrides: Partial<SanctionedParty> = {}): SanctionedParty => ({
  uid: '4632',
  entryType: 'ORGANIZATION',
  names: ['BANK MARKAZI JOMHOURI ISLAMI IRAN'],
  documents: [],
  walletAddresses: [],
  country: 'Iran',
  ...overrides,
});

const record = (ref: string, overrides: Partial<SanctionListRecord> = {}): SanctionListRecord => ({
  externalRef: ref,
  entryType: 'PERSON',
  name: `Name ${ref}`,
  document: null,
  walletAddress: null,
  country: null,
  ...overrides,
});

const snapshot = (ref: string, overrides: Partial<SyncedEntrySnapshot> = {}): SyncedEntrySnapshot => ({
  id: createWatchlistEntryId(oid(`entry-${ref}`)),
  externalRef: ref,
  fingerprint: fingerprintRecord(record(ref)),
  active: true,
  ...overrides,
});

describe('expandSanctionedParty', () => {
  it('writes one entry per distinct name, collapsing spellings that normalize the same', () => {
    const records = expandSanctionedParty(
      party({ names: ['Bank Markazi', 'BANK MARKAZI', 'Bänk Markazi', 'Central Bank of Iran'] }),
    );

    expect(records.map((r) => r.name)).toEqual(['Bank Markazi', 'Central Bank of Iran']);
    expect(records.every((r) => r.entryType === 'ORGANIZATION' && r.country === 'Iran')).toBe(true);
  });

  it('writes documents and wallets as their own entries, named after the primary name', () => {
    const records = expandSanctionedParty(
      party({ documents: [' P123 '], walletAddresses: ['TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81'] }),
    );

    expect(records.find((r) => r.document !== null)).toEqual(
      expect.objectContaining({ name: 'BANK MARKAZI JOMHOURI ISLAMI IRAN', document: 'P123', entryType: 'ORGANIZATION' }),
    );
    // Wallet entries are WALLET whatever the party is, and keep the published casing:
    // base58 addresses are case-sensitive even though the ref is lowercased for stability.
    expect(records.find((r) => r.walletAddress !== null)).toEqual(
      expect.objectContaining({
        entryType: 'WALLET',
        walletAddress: 'TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81',
        externalRef: '4632|wallet|tniq9axbp9ejuqhdhrwrfvaa8u3guqzh81',
      }),
    );
  });

  it('keys names by their normalized form, so reordering aliases does not change any reference', () => {
    const refs = (names: string[]) => expandSanctionedParty(party({ names })).map((r) => r.externalRef).sort();

    expect(refs(['Alpha Trading', 'Beta Holdings'])).toEqual(refs(['Beta Holdings', 'Alpha Trading']));
  });

  it('produces nothing for a party without a usable name', () => {
    expect(expandSanctionedParty(party({ names: ['  ', '...'], documents: ['P1'] }))).toEqual([]);
  });
});

describe('fingerprintRecord', () => {
  it('does not let two different field splits collide', () => {
    expect(fingerprintRecord(record('x', { name: 'ab', document: null }))).not.toBe(
      fingerprintRecord(record('x', { name: 'a', document: 'b' })),
    );
  });
});

describe('planWatchlistSync', () => {
  it('inserts new references and leaves identical ones alone', () => {
    const plan = planWatchlistSync([snapshot('a')], [record('a'), record('b')]);

    expect(plan.inserts.map((r) => r.externalRef)).toEqual(['b']);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('updates a changed entry in place, under its existing id', () => {
    const existing = snapshot('a');
    const plan = planWatchlistSync([existing], [record('a', { country: 'Cuba' })]);

    expect(plan.updates).toEqual([{ id: existing.id, record: record('a', { country: 'Cuba' }) }]);
    expect(plan.inserts).toEqual([]);
  });

  it('reactivates a relisted entry instead of inserting a duplicate', () => {
    const delisted = snapshot('a', { active: false });
    const plan = planWatchlistSync([delisted], [record('a')]);

    expect(plan.updates.map((u) => u.id)).toEqual([delisted.id]);
    expect(plan.inserts).toEqual([]);
  });

  it('removes active entries the list no longer publishes, and ignores ones already removed', () => {
    const gone = snapshot('gone');
    const plan = planWatchlistSync([snapshot('a'), gone, snapshot('old', { active: false })], [record('a')]);

    expect(plan.removals).toEqual([gone.id]);
  });

  it('counts a reference published twice once', () => {
    const plan = planWatchlistSync([], [record('a'), record('a')]);

    expect(plan.inserts).toHaveLength(1);
  });
});

describe('refuseUnsafeSync', () => {
  const existing = Array.from({ length: 10 }, (_, i) => snapshot(`e${i}`));
  const planRemoving = (count: number) =>
    planWatchlistSync(
      existing,
      existing.slice(count).map((s) => record(s.externalRef)),
    );

  it('refuses an empty download outright', () => {
    expect(refuseUnsafeSync(planWatchlistSync(existing, []), 0, existing)).toBe('EMPTY_FEED');
  });

  it(`allows delisting up to ${MAX_REMOVAL_RATIO * 100}% of the active entries`, () => {
    expect(refuseUnsafeSync(planRemoving(2), 8, existing)).toBeNull();
  });

  it('refuses a run that would delist more than that', () => {
    expect(refuseUnsafeSync(planRemoving(3), 7, existing)).toBe('TOO_MANY_REMOVALS');
  });

  it('allows the first sync, when there is nothing to remove yet', () => {
    expect(refuseUnsafeSync(planWatchlistSync([], [record('a')]), 1, [])).toBeNull();
  });
});
