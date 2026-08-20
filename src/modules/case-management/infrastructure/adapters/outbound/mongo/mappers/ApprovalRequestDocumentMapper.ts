import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { ApprovalRequest } from '../../../../../domain/model/aggregates/ApprovalRequest.js';
import { createApprovalRequestId } from '../../../../../domain/model/value-objects/ApprovalRequestId.js';
import { createApprovalRequestStatus } from '../../../../../domain/model/value-objects/ApprovalRequestStatus.js';
import { createEnforcementActionId } from '../../../../../domain/model/value-objects/EnforcementActionId.js';
import type { ApprovalRequestDocument } from '../documents/ApprovalRequestDocument.js';

export function toDocument(request: ApprovalRequest): ApprovalRequestDocument {
  return {
    _id: new ObjectId(request.id),
    enforcement_action_id: new ObjectId(request.enforcementActionId),
    requester_id: new ObjectId(request.requesterId),
    reviewer_id: request.reviewerId === null ? null : new ObjectId(request.reviewerId),
    status: request.status,
    reviewer_comment: request.reviewerComment,
    created_at: toDate(request.createdAt),
    reviewed_at: request.reviewedAt === null ? null : toDate(request.reviewedAt),
  };
}

export function toDomain(document: ApprovalRequestDocument): ApprovalRequest {
  return ApprovalRequest.rehydrate({
    id: createApprovalRequestId(document._id.toString()),
    enforcementActionId: createEnforcementActionId(document.enforcement_action_id.toString()),
    requesterId: document.requester_id.toString(),
    reviewerId: document.reviewer_id?.toString() ?? null,
    status: createApprovalRequestStatus(document.status),
    reviewerComment: document.reviewer_comment,
    createdAt: fromDate(document.created_at),
    reviewedAt: document.reviewed_at === null ? null : fromDate(document.reviewed_at),
  });
}
