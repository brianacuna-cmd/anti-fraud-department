import { invariantViolation } from '../../errors/CaseManagementError.js';

export type ApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

const VALID: ReadonlySet<string> = new Set<ApprovalRequestStatus>(['PENDING', 'APPROVED', 'REJECTED']);

export function createApprovalRequestStatus(value: string): ApprovalRequestStatus {
  if (!VALID.has(value)) {
    throw invariantViolation(
      'ApprovalRequestStatus must be one of PENDING, APPROVED, REJECTED',
      { value },
    );
  }
  return value as ApprovalRequestStatus;
}
