import { invariantViolation } from '../../errors/CaseManagementError.js';

/** Closed catalog of entities an investigation can target (product-confirmed). */
export type InvestigationSubjectType = 'WALLET' | 'EMAIL' | 'CUSTOMER';

export const INVESTIGATION_SUBJECT_TYPES = ['WALLET', 'EMAIL', 'CUSTOMER'] as const;

const VALID: ReadonlySet<string> = new Set<InvestigationSubjectType>(INVESTIGATION_SUBJECT_TYPES);

export function createInvestigationSubjectType(value: string): InvestigationSubjectType {
  if (!VALID.has(value)) {
    throw invariantViolation('InvestigationSubjectType must be one of WALLET, EMAIL, CUSTOMER', { value });
  }
  return value as InvestigationSubjectType;
}
