import { brand, type Brand } from '../../../../../shared/kernel/Brand.js';
import { generateObjectIdHex, isObjectIdHex } from '../../../../../shared/kernel/ObjectIdHex.js';
import { invariantViolation } from '../../errors/CaseManagementError.js';

export type ApprovalRequestId = Brand<string, 'ApprovalRequestId'>;

export function createApprovalRequestId(value: string): ApprovalRequestId {
  if (!isObjectIdHex(value)) {
    throw invariantViolation('ApprovalRequestId must be a 24-character hexadecimal ObjectId', {
      value,
    });
  }
  return brand<string, 'ApprovalRequestId'>(value);
}

export function generateApprovalRequestId(): ApprovalRequestId {
  return brand<string, 'ApprovalRequestId'>(generateObjectIdHex());
}
