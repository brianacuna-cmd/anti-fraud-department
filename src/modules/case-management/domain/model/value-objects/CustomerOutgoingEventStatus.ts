import { invariantViolation } from '../../errors/CaseManagementError.js';

export type CustomerOutgoingEventStatus = 'PENDING' | 'SENT' | 'FAILED';

const VALID: ReadonlySet<string> = new Set<CustomerOutgoingEventStatus>([
  'PENDING',
  'SENT',
  'FAILED',
]);

export function createCustomerOutgoingEventStatus(value: string): CustomerOutgoingEventStatus {
  if (!VALID.has(value)) {
    throw invariantViolation(
      'CustomerOutgoingEventStatus must be one of PENDING, SENT, FAILED',
      { value },
    );
  }
  return value as CustomerOutgoingEventStatus;
}
