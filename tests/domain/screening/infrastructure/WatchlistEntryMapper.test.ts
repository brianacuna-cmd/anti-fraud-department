import { ObjectId } from 'mongodb';
import { oid } from '../../../support/oid.js';
import {
  toDomain,
  toDocument,
} from '../../../../src/modules/screening/infrastructure/adapters/outbound/mongo/mappers/WatchlistEntryMapper.js';
import { WatchlistEntry } from '../../../../src/modules/screening/domain/model/aggregates/WatchlistEntry.js';
import { generateWatchlistEntryId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistEntryId.js';
import { generateWatchlistId } from '../../../../src/modules/screening/domain/model/value-objects/WatchlistId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import type { WatchlistEntryDocument } from '../../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistEntryDocument.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildDocument(overrides: Partial<WatchlistEntryDocument> = {}): WatchlistEntryDocument {
  return {
    _id: new ObjectId(oid('entry-1')),
    watchlist_id: new ObjectId(oid('watchlist-1')),
    organization_id: new ObjectId(oid('org-1')),
    entry_type: 'PERSON',
    name: 'John Smith',
    normalized_name: 'john smith',
    phonetic_keys: ['JN', 'SM0'],
    document: '123456789',
    wallet_address: null,
    risk_level: 'HIGH',
    country: 'US',
    status: 'ACTIVE',
    deleted_at: null,
    created_at: new Date(NOW),
    updated_at: new Date(NOW),
    ...overrides,
  };
}

describe('WatchlistEntryMapper.toDomain', () => {
  it('maps all fields correctly from document to WatchlistEntry aggregate', () => {
    const doc = buildDocument();
    const entry = toDomain(doc);

    expect(entry.id).toBe(oid('entry-1'));
    expect(entry.watchlistId).toBe(oid('watchlist-1'));
    expect(entry.organizationId).toBe(oid('org-1'));
    expect(entry.entryType).toBe('PERSON');
    expect(entry.name).toBe('John Smith');
    expect(entry.document).toBe('123456789');
    expect(entry.walletAddress).toBeNull();
    expect(entry.riskLevel).toBe('HIGH');
    expect(entry.country).toBe('US');
    expect(entry.status).toBe('ACTIVE');
    expect(entry.deletedAt).toBeNull();
    expect(entry.createdAt).toBe(NOW);
    expect(entry.updatedAt).toBe(NOW);
  });

  it('maps a soft-deleted document (status REMOVED, deletedAt set)', () => {
    const doc = buildDocument({ status: 'REMOVED', deleted_at: new Date(LATER) });
    const entry = toDomain(doc);

    expect(entry.status).toBe('REMOVED');
    expect(entry.deletedAt).toBe(LATER);
  });
});

describe('WatchlistEntryMapper.toDocument', () => {
  it('maps all fields correctly from WatchlistEntry aggregate to document', () => {
    const entry = WatchlistEntry.create({
      id: generateWatchlistEntryId(),
      watchlistId: generateWatchlistId(),
      organizationId: oid('org-1'),
      entryType: 'ORGANIZATION',
      name: 'Acme Corp',
      riskLevel: 'LOW',
      country: 'US',
      now: NOW,
    });

    const doc = toDocument(entry);

    expect(doc._id.toString()).toBe(entry.id);
    expect(doc.watchlist_id.toString()).toBe(entry.watchlistId);
    expect(doc.organization_id.toString()).toBe(oid('org-1'));
    expect(doc.entry_type).toBe('ORGANIZATION');
    expect(doc.name).toBe('Acme Corp');
    expect(doc.risk_level).toBe('LOW');
    expect(doc.country).toBe('US');
    expect(doc.status).toBe('ACTIVE');
    expect(doc.deleted_at).toBeNull();
    expect(doc.created_at).toBeInstanceOf(Date);
    expect(doc.updated_at).toBeInstanceOf(Date);
  });

  it('round-trips toDomain -> toDocument preserving all fields', () => {
    const original = buildDocument();
    const domainEntry = toDomain(original);
    const backToDoc = toDocument(domainEntry);

    expect(backToDoc._id.toString()).toBe(oid('entry-1'));
    expect(backToDoc.name).toBe('John Smith');
    expect(backToDoc.risk_level).toBe('HIGH');
    expect(backToDoc.status).toBe('ACTIVE');
    expect(backToDoc.deleted_at).toBeNull();
    expect(backToDoc.created_at).toEqual(new Date(NOW));
    expect(backToDoc.updated_at).toEqual(new Date(NOW));
  });
});

describe('WatchlistEntryMapper.toDomain pre-B documents', () => {
  it('falls back to the ObjectId timestamp when created_at/updated_at are absent', () => {
    const doc = buildDocument({ created_at: undefined, updated_at: undefined });
    const entry = toDomain(doc);
    const objectIdTime = fromDate(doc._id.getTimestamp());

    expect(entry.createdAt).toBe(objectIdTime);
    expect(entry.updatedAt).toBe(objectIdTime);
  });
});
