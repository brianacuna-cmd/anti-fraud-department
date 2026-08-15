import { invariantViolation } from '../../errors/IngestError.js';

export type ProviderIngestStatus = 'RECEIVED' | 'IGNORED' | 'FAILED' | 'PROCESSED';

const VALID: ReadonlySet<string> = new Set<ProviderIngestStatus>([
  'RECEIVED',
  'IGNORED',
  'FAILED',
  'PROCESSED',
]);

export function createProviderIngestStatus(value: string): ProviderIngestStatus {
  if (!VALID.has(value)) {
    throw invariantViolation(
      'ProviderIngestStatus must be one of RECEIVED, IGNORED, FAILED, PROCESSED',
      { value },
    );
  }
  return value as ProviderIngestStatus;
}

/** Statuses allowed on first persist (HTTP ACK may still say PROCESSED). */
export type InitialProviderIngestStatus = Exclude<ProviderIngestStatus, 'PROCESSED'>;

export function createInitialProviderIngestStatus(value: string): InitialProviderIngestStatus {
  const status = createProviderIngestStatus(value);
  if (status === 'PROCESSED') {
    throw invariantViolation('ProviderIngestEvent initial status cannot be PROCESSED', { value });
  }
  return status;
}
