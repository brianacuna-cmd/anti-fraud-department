import type { PrivacyDataRequest } from '../../../../../domain/model/aggregates/PrivacyDataRequest.js';
import type { Instant } from '../../../../../../../shared/time/Instant.js';

export interface PrivacyDataRequestResponse {
  readonly id: string;
  readonly organizationId: string;
  readonly subjectEmail: string;
  readonly subjectCustomerId: string | null;
  readonly type: string;
  readonly status: string;
  readonly requesterNote: string | null;
  readonly receivedAt: string;
  readonly dueAt: string;
  /**
   * Computed at read time, not stored: whether the deadline has passed is a
   * fact about NOW, and a flag frozen in the row would be wrong the moment
   * after it was written.
   */
  readonly overdue: boolean;
  readonly resolution: string | null;
  readonly resolutionNote: string | null;
  readonly certificateSha256: string | null;
  readonly resolvedBy: string | null;
  readonly resolvedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toPrivacyDataRequestResponse(
  request: PrivacyDataRequest,
  now: Instant,
): PrivacyDataRequestResponse {
  return {
    id: request.id,
    organizationId: request.organizationId,
    subjectEmail: request.subjectEmail,
    subjectCustomerId: request.subjectCustomerId,
    type: request.type,
    status: request.status,
    requesterNote: request.requesterNote,
    receivedAt: request.receivedAt,
    dueAt: request.dueAt,
    overdue: request.isOverdue(now),
    resolution: request.resolution,
    resolutionNote: request.resolutionNote,
    certificateSha256: request.certificateHash,
    resolvedBy: request.resolvedBy,
    resolvedAt: request.resolvedAt,
    createdBy: request.createdBy,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
