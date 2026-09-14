import { ObjectId } from 'mongodb';
import { oid } from '../../support/oid.js';
import { toDocument, toDomain } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/mappers/WatchlistDocumentMapper.js';
import { toWatchlistResponse } from '../../../src/modules/screening/infrastructure/adapters/inbound/http/mappers/WatchlistHttpMapper.js';
import type { WatchlistDocument } from '../../../src/modules/screening/infrastructure/adapters/outbound/mongo/documents/WatchlistDocument.js';

const SYNCED_AT = new Date('2026-09-11T04:00:00.000Z');

const document: WatchlistDocument = {
  _id: new ObjectId(oid('watchlist-ofac')),
  organization_id: new ObjectId(oid('org-1')),
  name: 'OFAC SDN (official feed)',
  source: 'OFAC_SDN',
  type: 'BLACKLIST',
  description: null,
  status: 'ACTIVE',
  deleted_at: null,
  created_at: new Date('2026-09-01T00:00:00.000Z'),
  updated_at: new Date('2026-09-01T00:00:00.000Z'),
};

describe('watchlist last_synced_at (AML-001)', () => {
  /*
   * `MongoWatchlistRepository.save` replaces the whole document. If the
   * mapper dropped the field, editing the watchlist once would make a list
   * synced last night read as never synced.
   */
  it('survives a save, which rewrites the whole document', () => {
    const saved = toDocument(toDomain({ ...document, last_synced_at: SYNCED_AT }));

    expect(saved.last_synced_at).toEqual(SYNCED_AT);
  });

  it('reads as null for a watchlist that was never synced, including pre-existing documents', () => {
    expect(toDomain(document).toProps().lastSyncedAt).toBeNull();
    expect(toDocument(toDomain(document)).last_synced_at).toBeNull();
  });

  it('is exposed to the portal', () => {
    expect(toWatchlistResponse(toDomain({ ...document, last_synced_at: SYNCED_AT })).lastSyncedAt).toBe(
      SYNCED_AT.toISOString(),
    );
    expect(toWatchlistResponse(toDomain(document)).lastSyncedAt).toBeNull();
  });
});
