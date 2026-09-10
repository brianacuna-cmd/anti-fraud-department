import { ObjectId } from 'mongodb';
import { fromDate } from '../../../../../../../shared/time/Instant.js';
import { PrivacyDataRequest } from '../../../../../domain/model/aggregates/PrivacyDataRequest.js';
import { createPrivacyDataRequestId } from '../../../../../domain/model/value-objects/PrivacyDataRequestId.js';
import { createPrivacyRequestType } from '../../../../../domain/model/value-objects/PrivacyRequestType.js';
import {
  createPrivacyRequestStatus,
  createPrivacyResolution,
} from '../../../../../domain/model/value-objects/PrivacyRequestStatus.js';
import type { PrivacyDataRequestDocument } from '../documents/PrivacyDataRequestDocument.js';

export function toDocument(request: PrivacyDataRequest): PrivacyDataRequestDocument {
  const p = request.toProps();
  return {
    _id: new ObjectId(p.id),
    organization_id: new ObjectId(p.organizationId),
    subject_email: p.subjectEmail,
    subject_customer_id: p.subjectCustomerId,
    type: p.type,
    status: p.status,
    requester_note: p.requesterNote,
    received_at: new Date(p.receivedAt),
    due_at: new Date(p.dueAt),
    resolution: p.resolution,
    resolution_note: p.resolutionNote,
    certificate_sha256: p.certificateHash,
    resolved_by: p.resolvedBy,
    resolved_at: p.resolvedAt === null ? null : new Date(p.resolvedAt),
    created_by: p.createdBy,
    created_at: new Date(p.createdAt),
    updated_at: new Date(p.updatedAt),
  };
}

export function toDomain(document: PrivacyDataRequestDocument): PrivacyDataRequest {
  return PrivacyDataRequest.rehydrate({
    id: createPrivacyDataRequestId(document._id.toHexString()),
    organizationId: document.organization_id.toHexString(),
    subjectEmail: document.subject_email,
    subjectCustomerId: document.subject_customer_id,
    type: createPrivacyRequestType(document.type),
    status: createPrivacyRequestStatus(document.status),
    requesterNote: document.requester_note,
    receivedAt: fromDate(document.received_at),
    dueAt: fromDate(document.due_at),
    resolution: document.resolution === null ? null : createPrivacyResolution(document.resolution),
    resolutionNote: document.resolution_note,
    certificateHash: document.certificate_sha256,
    resolvedBy: document.resolved_by,
    resolvedAt: document.resolved_at === null ? null : fromDate(document.resolved_at),
    createdBy: document.created_by,
    createdAt: fromDate(document.created_at),
    updatedAt: fromDate(document.updated_at),
  });
}
