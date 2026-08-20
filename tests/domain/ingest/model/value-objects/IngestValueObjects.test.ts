import { createPaymentProvider } from '../../../../../src/modules/ingest/domain/model/value-objects/PaymentProvider.js';
import { createProviderIngestStatus } from '../../../../../src/modules/ingest/domain/model/value-objects/ProviderIngestStatus.js';
import { IngestError } from '../../../../../src/modules/ingest/domain/errors/IngestError.js';

describe('PaymentProvider', () => {
  it('accepts stripe, bridge, and coinflow', () => {
    expect(createPaymentProvider('stripe')).toBe('stripe');
    expect(createPaymentProvider('bridge')).toBe('bridge');
    expect(createPaymentProvider('coinflow')).toBe('coinflow');
  });

  it('rejects an unknown provider', () => {
    expect(() => createPaymentProvider('adyen')).toThrow(IngestError);
  });
});

describe('ProviderIngestStatus', () => {
  it('accepts RECEIVED, IGNORED, FAILED, and PROCESSED', () => {
    expect(createProviderIngestStatus('RECEIVED')).toBe('RECEIVED');
    expect(createProviderIngestStatus('IGNORED')).toBe('IGNORED');
    expect(createProviderIngestStatus('FAILED')).toBe('FAILED');
    expect(createProviderIngestStatus('PROCESSED')).toBe('PROCESSED');
  });

  it('rejects an unknown status', () => {
    expect(() => createProviderIngestStatus('DUPLICATE')).toThrow(IngestError);
  });
});
