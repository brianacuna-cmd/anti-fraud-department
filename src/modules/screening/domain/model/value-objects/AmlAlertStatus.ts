import { invariantViolation } from '../../errors/ScreeningError.js';

export type AmlAlertStatus = 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'FALSE_POSITIVE';

const VALID_STATUSES: ReadonlySet<string> = new Set<AmlAlertStatus>([
  'OPEN',
  'INVESTIGATING',
  'RESOLVED',
  'FALSE_POSITIVE',
]);

export function createAmlAlertStatus(value: string): AmlAlertStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation(
      'AmlAlertStatus must be one of OPEN, INVESTIGATING, RESOLVED, FALSE_POSITIVE',
      { value },
    );
  }
  return value as AmlAlertStatus;
}
