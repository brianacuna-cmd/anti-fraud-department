import type { ApprovalRequest } from '../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import type { ApprovalRequestRepository } from '../../../src/modules/case-management/domain/ports/ApprovalRequestRepository.js';
import type { ApprovalRequestId } from '../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import type { EnforcementActionId } from '../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import type { Transaction } from '../../../src/modules/case-management/domain/ports/UnitOfWork.js';

export class InMemoryApprovalRequestRepository implements ApprovalRequestRepository {
  private readonly byId = new Map<string, ApprovalRequest>();

  async save(request: ApprovalRequest, _tx?: Transaction): Promise<void> {
    this.byId.set(request.id, request);
  }

  async findById(id: ApprovalRequestId, _tx?: Transaction): Promise<ApprovalRequest | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEnforcementActionId(
    enforcementActionId: EnforcementActionId,
    _tx?: Transaction,
  ): Promise<ApprovalRequest | null> {
    return (
      [...this.byId.values()].find((request) => request.enforcementActionId === enforcementActionId) ??
      null
    );
  }

  all(): readonly ApprovalRequest[] {
    return [...this.byId.values()];
  }
}
