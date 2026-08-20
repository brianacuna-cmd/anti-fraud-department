import { invariantViolation } from '../../errors/CaseManagementError.js';

export type EnforcementActionType = 'BLOCK' | 'RESTRICT' | 'SUSPEND' | 'DELETE' | 'REVIEW';

const VALID: ReadonlySet<string> = new Set<EnforcementActionType>([
  'BLOCK',
  'RESTRICT',
  'SUSPEND',
  'DELETE',
  'REVIEW',
]);

export function createEnforcementActionType(value: string): EnforcementActionType {
  if (!VALID.has(value)) {
    throw invariantViolation(
      'EnforcementActionType must be one of BLOCK, RESTRICT, SUSPEND, DELETE, REVIEW',
      { value },
    );
  }
  return value as EnforcementActionType;
}
