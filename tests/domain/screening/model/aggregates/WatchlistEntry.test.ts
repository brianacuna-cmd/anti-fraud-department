import { oid } from '../../../../support/oid.js';
import { WatchlistEntry } from '../../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { generateWatchlistEntryId } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { generateWatchlistId } from '../../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildEntry(): WatchlistEntry {
  return WatchlistEntry.create({
    id: generateWatchlistEntryId(),
    watchlistId: generateWatchlistId(),
    organizationId: oid('org-1'),
    entryType: 'PERSON',
    name: 'John Smith',
    document: '123456789',
    walletAddress: null,
    riskLevel: 'HIGH',
    country: 'US',
    now: NOW,
  });
}

describe('WatchlistEntry.create', () => {
  it('starts ACTIVE with no deletedAt and stores all provided fields', () => {
    const entry = buildEntry();

    expect(entry.status).toBe('ACTIVE');
    expect(entry.deletedAt).toBeNull();
    expect(entry.createdAt).toBe(NOW);
    expect(entry.updatedAt).toBe(NOW);
    expect(entry.name).toBe('John Smith');
    expect(entry.entryType).toBe('PERSON');
    expect(entry.riskLevel).toBe('HIGH');
    expect(entry.country).toBe('US');
    expect(entry.document).toBe('123456789');
    expect(entry.walletAddress).toBeNull();
  });

  it('defaults optional fields to null when not provided', () => {
    const entry = WatchlistEntry.create({
      id: generateWatchlistEntryId(),
      watchlistId: generateWatchlistId(),
      organizationId: oid('org-1'),
      entryType: 'ORGANIZATION',
      name: 'Acme Corp',
      now: NOW,
    });

    expect(entry.document).toBeNull();
    expect(entry.walletAddress).toBeNull();
    expect(entry.riskLevel).toBeNull();
    expect(entry.country).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(() =>
      WatchlistEntry.create({
        id: generateWatchlistEntryId(),
        watchlistId: generateWatchlistId(),
        organizationId: oid('org-1'),
        entryType: 'PERSON',
        name: '   ',
        now: NOW,
      }),
    ).toThrow(ScreeningError);
  });

  it('rejects an empty organizationId', () => {
    expect(() =>
      WatchlistEntry.create({
        id: generateWatchlistEntryId(),
        watchlistId: generateWatchlistId(),
        organizationId: '  ',
        entryType: 'PERSON',
        name: 'Valid Name',
        now: NOW,
      }),
    ).toThrow(ScreeningError);
  });
});

describe('WatchlistEntry.rehydrate', () => {
  it('reconstructs from stored props without re-validating', () => {
    const id = generateWatchlistEntryId();
    const watchlistId = generateWatchlistId();
    const entry = WatchlistEntry.rehydrate({
      id,
      watchlistId,
      organizationId: oid('org-1'),
      entryType: 'PERSON',
      name: 'Jane Doe',
      document: null,
      walletAddress: null,
      riskLevel: 'LOW',
      country: null,
      status: 'REMOVED',
      deletedAt: LATER,
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(entry.status).toBe('REMOVED');
    expect(entry.deletedAt).toBe(LATER);
    expect(entry.id).toBe(id);
    expect(entry.watchlistId).toBe(watchlistId);
  });
});

describe('WatchlistEntry#update', () => {
  it('returns a new instance with bumped updatedAt and mutated fields', () => {
    const entry = buildEntry();

    const updated = entry.update({ name: 'John Smith Jr.', riskLevel: 'CRITICAL' }, LATER);

    expect(updated).not.toBe(entry);
    expect(updated.name).toBe('John Smith Jr.');
    expect(updated.riskLevel).toBe('CRITICAL');
    expect(updated.updatedAt).toBe(LATER);
    expect(entry.name).toBe('John Smith');
  });

  it('rejects an empty name on update', () => {
    const entry = buildEntry();
    expect(() => entry.update({ name: '' }, LATER)).toThrow(ScreeningError);
  });
});

describe('WatchlistEntry#softDelete', () => {
  it('sets status REMOVED and deletedAt/updatedAt to now', () => {
    const entry = buildEntry();

    const deleted = entry.softDelete(LATER);

    expect(deleted).not.toBe(entry);
    expect(deleted.status).toBe('REMOVED');
    expect(deleted.deletedAt).toBe(LATER);
    expect(deleted.updatedAt).toBe(LATER);
    expect(entry.status).toBe('ACTIVE');
  });
});
