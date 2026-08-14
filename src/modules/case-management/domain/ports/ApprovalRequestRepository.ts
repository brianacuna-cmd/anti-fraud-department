import type { ApprovalRequest } from '../model/aggregates/ApprovalRequest.js';
import type { ApprovalRequestId } from '../model/value-objects/ApprovalRequestId.js';
import type { EnforcementActionId } from '../model/value-objects/EnforcementActionId.js';
import type { Transaction } from './UnitOfWork.js';

export interface ApprovalRequestRepository {
  save(request: ApprovalRequest, tx?: Transaction): Promise<void>;
  findById(id: ApprovalRequestId, tx?: Transaction): Promise<ApprovalRequest | null>;
  findByEnforcementActionId(
    enforcementActionId: EnforcementActionId,
    tx?: Transaction,
  ): Promise<ApprovalRequest | null>;
}
