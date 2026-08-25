import { oid } from '../../../../support/oid.js';
import { Watchlist } from '../../../../../src/modules/screening/domain/model/aggregates/Watchlist.js';
import { generateWatchlistId } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildWatchlist(): Watchlist {
  return Watchlist.create({
    id: generateWatchlistId(),
    organizationId: oid('org-1'),
    name: 'Global Sanctions',
    source: 'OFAC',
    type: 'BLACKLIST',
    description: 'OFAC SDN list',
    now: NOW,
  });
}

describe('Watchlist.create', () => {
  it('starts ACTIVE with no deletedAt', () => {
    const watchlist = buildWatchlist();

    expect(watchlist.status).toBe('ACTIVE');
    expect(watchlist.deletedAt).toBeNull();
    expect(watchlist.createdAt).toBe(NOW);
    expect(watchlist.updatedAt).toBe(NOW);
    expect(watchlist.name).toBe('Global Sanctions');
    expect(watchlist.type).toBe('BLACKLIST');
  });

  it('defaults description to null when not provided', () => {
    const watchlist = Watchlist.create({
      id: generateWatchlistId(),
      organizationId: oid('org-1'),
      name: 'Internal List',
      source: 'manual',
      type: 'WHITELIST',
      now: NOW,
    });

    expect(watchlist.description).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(() =>
      Watchlist.create({
        id: generateWatchlistId(),
        organizationId: oid('org-1'),
        name: '   ',
        source: 'OFAC',
        type: 'BLACKLIST',
        now: NOW,
      }),
    ).toThrow(ScreeningError);
  });

  it('rejects an empty source', () => {
    expect(() =>
      Watchlist.create({
        id: generateWatchlistId(),
        organizationId: oid('org-1'),
        name: 'Global Sanctions',
        source: '  ',
        type: 'BLACKLIST',
        now: NOW,
      }),
    ).toThrow(ScreeningError);
  });

  it('rejects an empty organizationId', () => {
    expect(() =>
      Watchlist.create({
        id: generateWatchlistId(),
        organizationId: '  ',
        name: 'Global Sanctions',
        source: 'OFAC',
        type: 'BLACKLIST',
        now: NOW,
      }),
    ).toThrow(ScreeningError);
  });
});

describe('Watchlist.rehydrate', () => {
  it('reconstructs from stored props without re-validating', () => {
    const watchlist = Watchlist.rehydrate({
      id: generateWatchlistId(),
      organizationId: oid('org-1'),
      name: 'Global Sanctions',
      source: 'OFAC',
      type: 'BLACKLIST',
      description: null,
      status: 'INACTIVE',
      deletedAt: LATER,
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(watchlist.status).toBe('INACTIVE');
    expect(watchlist.deletedAt).toBe(LATER);
    expect(watchlist.updatedAt).toBe(LATER);
  });
});

describe('Watchlist#update', () => {
  it('returns a new instance with bumped updatedAt and mutated fields', () => {
    const watchlist = buildWatchlist();

    const updated = watchlist.update({ name: 'Renamed List', description: 'new desc' }, LATER);

    expect(updated).not.toBe(watchlist);
    expect(updated.name).toBe('Renamed List');
    expect(updated.description).toBe('new desc');
    expect(updated.updatedAt).toBe(LATER);
    expect(watchlist.name).toBe('Global Sanctions');
  });

  it('rejects an empty name', () => {
    const watchlist = buildWatchlist();

    expect(() => watchlist.update({ name: '   ' }, LATER)).toThrow(ScreeningError);
  });

  it('rejects an empty source', () => {
    const watchlist = buildWatchlist();

    expect(() => watchlist.update({ source: '' }, LATER)).toThrow(ScreeningError);
  });
});

describe('Watchlist#softDelete', () => {
  it('sets status INACTIVE and deletedAt/updatedAt to now', () => {
    const watchlist = buildWatchlist();

    const deleted = watchlist.softDelete(LATER);

    expect(deleted).not.toBe(watchlist);
    expect(deleted.status).toBe('INACTIVE');
    expect(deleted.deletedAt).toBe(LATER);
    expect(deleted.updatedAt).toBe(LATER);
    expect(watchlist.status).toBe('ACTIVE');
  });
});
