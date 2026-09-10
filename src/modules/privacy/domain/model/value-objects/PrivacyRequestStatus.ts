import { invariantViolation } from '../../errors/PrivacyError.js';

/**
 * Where the request is in its handling.
 *
 * `RECEIVED` exists as a separate state from `IN_PROGRESS` because the legal
 * clock starts at reception, not when somebody gets around to it: a request
 * sitting in `RECEIVED` past its deadline is precisely the finding an auditor
 * looks for, and collapsing the two states would hide it.
 */
export type PrivacyRequestStatus = 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED';

export const PRIVACY_REQUEST_STATUSES = [
  'RECEIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'REJECTED',
] as const;

const VALID: ReadonlySet<string> = new Set<PrivacyRequestStatus>(PRIVACY_REQUEST_STATUSES);

export function createPrivacyRequestStatus(value: string): PrivacyRequestStatus {
  if (!VALID.has(value)) {
    throw invariantViolation(`unknown privacy request status "${value}"`, {
      value,
      allowed: [...PRIVACY_REQUEST_STATUSES],
    });
  }
  return value as PrivacyRequestStatus;
}

/** `COMPLETED` and `REJECTED` are terminal: a resolved request is not reopened. */
export function isTerminal(status: PrivacyRequestStatus): boolean {
  return status === 'COMPLETED' || status === 'REJECTED';
}

/**
 * How the tenant answered.
 *
 * `PARTIALLY_FULFILLED` is not a courtesy label: it is the honest outcome of
 * an erasure that masked the identity fields but kept the financial trail
 * that antilaundering law requires. Recording it as `FULFILLED` would claim
 * data was deleted that was not.
 */
export type PrivacyResolution = 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'REJECTED';

export const PRIVACY_RESOLUTIONS = ['FULFILLED', 'PARTIALLY_FULFILLED', 'REJECTED'] as const;

const VALID_RESOLUTIONS: ReadonlySet<string> = new Set<PrivacyResolution>(PRIVACY_RESOLUTIONS);

export function createPrivacyResolution(value: string): PrivacyResolution {
  if (!VALID_RESOLUTIONS.has(value)) {
    throw invariantViolation(`unknown privacy resolution "${value}"`, {
      value,
      allowed: [...PRIVACY_RESOLUTIONS],
    });
  }
  return value as PrivacyResolution;
}
