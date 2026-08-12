import { invariantViolation } from '../../errors/CaseManagementError.js';

/**
 * `CaseSlaTracking`'s own status union (spec: "CaseSlaTracking status
 * lifecycle"): ON_TRACK -> WARNING -> BREACHED, forward-only. The full edge
 * set lives in `slaStatusTransitions` (services/transitions.ts).
 */
export type SlaStatus = 'ON_TRACK' | 'WARNING' | 'BREACHED';

const VALID_STATUSES: ReadonlySet<string> = new Set<SlaStatus>(['ON_TRACK', 'WARNING', 'BREACHED']);

export function createSlaStatus(value: string): SlaStatus {
  if (!VALID_STATUSES.has(value)) {
    throw invariantViolation('SlaStatus must be one of ON_TRACK, WARNING, BREACHED', { value });
  }
  return value as SlaStatus;
}
