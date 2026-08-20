import { ProviderIngestEvent } from '../../../../../src/modules/ingest/domain/model/aggregates/ProviderIngestEvent.js';
import { generateProviderIngestEventId } from '../../../../../src/modules/ingest/domain/model/value-objects/ProviderIngestEventId.js';
import { IngestError } from '../../../../../src/modules/ingest/domain/errors/IngestError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';
import { oid } from '../../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function create(
  overrides: Partial<Parameters<typeof ProviderIngestEvent.create>[0]> = {},
): ProviderIngestEvent {
  return ProviderIngestEvent.create({
    id: generateProviderIngestEventId(),
    organizationId: oid('org-1'),
    provider: 'stripe',
    providerEventId: 'evt_123',
    status: 'RECEIVED',
    now: NOW,
    ...overrides,
  });
}

describe('ProviderIngestEvent', () => {
  it('creates a RECEIVED row for a first mappable delivery', () => {
    const event = create();

    expect(event.organizationId).toBe(oid('org-1'));
    expect(event.provider).toBe('stripe');
    expect(event.providerEventId).toBe('evt_123');
    expect(event.status).toBe('RECEIVED');
    expect(event.createdAt).toBe(NOW);
    expect(event.updatedAt).toBe(NOW);
  });

  it('creates IGNORED and FAILED rows for unknown/unmappable deliveries', () => {
    expect(create({ status: 'IGNORED' }).status).toBe('IGNORED');
    expect(create({ status: 'FAILED' }).status).toBe('FAILED');
  });

  it('rejects PROCESSED as an initial status', () => {
    expect(() => create({ status: 'PROCESSED' })).toThrow(IngestError);
  });

  it('markProcessed transitions RECEIVED to PROCESSED', () => {
    const processed = create().markProcessed(LATER);

    expect(processed.status).toBe('PROCESSED');
    expect(processed.updatedAt).toBe(LATER);
    expect(processed.createdAt).toBe(NOW);
  });

  it('markFailed transitions RECEIVED to FAILED after post-ACK scoring failure', () => {
    const failed = create().markFailed(LATER);

    expect(failed.status).toBe('FAILED');
    expect(failed.updatedAt).toBe(LATER);
  });

  it('does not allow markProcessed from IGNORED', () => {
    expect(() => create({ status: 'IGNORED' }).markProcessed(LATER)).toThrow(IngestError);
  });

  it('rejects an empty providerEventId', () => {
    expect(() => create({ providerEventId: '  ' })).toThrow(IngestError);
  });

  it('rehydrates persisted props without re-validating', () => {
    const created = create({ status: 'FAILED' });
    const rehydrated = ProviderIngestEvent.rehydrate(created.toProps());

    expect(rehydrated.id).toBe(created.id);
    expect(rehydrated.status).toBe('FAILED');
    expect(rehydrated.providerEventId).toBe('evt_123');
  });
});
