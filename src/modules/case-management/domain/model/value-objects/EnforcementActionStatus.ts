import { invariantViolation } from '../../errors/CaseManagementError.js';

export type EnforcementActionStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'REVERTED';

const VALID: ReadonlySet<string> = new Set<EnforcementActionStatus>([
  'PENDING',
  'APPROVED',
  'EXECUTED',
  'REJECTED',
  'REVERTED',
]);

export function createEnforcementActionStatus(value: string): EnforcementActionStatus {
  if (!VALID.has(value)) {
    throw invariantViolation(
      'EnforcementActionStatus must be one of PENDING, APPROVED, EXECUTED, REJECTED, REVERTED',
      { value },
    );
  }
  return value as EnforcementActionStatus;
}
