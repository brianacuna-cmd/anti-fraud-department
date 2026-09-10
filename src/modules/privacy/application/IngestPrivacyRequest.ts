import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { PrivacyDataRequest } from '../domain/model/aggregates/PrivacyDataRequest.js';
import type { PrivacyDataRequestId } from '../domain/model/value-objects/PrivacyDataRequestId.js';
import type { PrivacyRequestType } from '../domain/model/value-objects/PrivacyRequestType.js';
import type { PrivacyDataRequestRepository } from '../domain/ports/PrivacyDataRequestRepository.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, PRIVACY_WRITE_ROLES } from './authorization/policy.js';

export interface IngestPrivacyRequestInput {
  readonly auth: AuthContext;
  readonly subjectEmail: string;
  readonly subjectCustomerId?: string | null;
  readonly type: PrivacyRequestType;
  readonly requesterNote?: string | null;
}

export interface IngestPrivacyRequestDeps {
  readonly requests: PrivacyDataRequestRepository;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generatePrivacyDataRequestId: () => PrivacyDataRequestId;
}

/**
 * PRIV-001: registers and classifies a data-subject rights request.
 *
 * Nothing is verified about the subject here — not that they exist, not that
 * the email is theirs. That is deliberate: under GDPR art. 12(3) the clock
 * starts when the request ARRIVES, and a controller that refuses to log a
 * request until it has identified the requester is a controller running out
 * its own deadline. Identity verification is part of ANSWERING the request
 * (PRIV-002/003 resolve the subject to real records), not of receiving it.
 */
export function createIngestPrivacyRequestUseCase(deps: IngestPrivacyRequestDeps) {
  return async function ingestPrivacyRequest(
    input: IngestPrivacyRequestInput,
  ): Promise<PrivacyDataRequest> {
    requireOperationalRole(input.auth, PRIVACY_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const now = deps.clock.now();
    const request = PrivacyDataRequest.create({
      id: deps.generatePrivacyDataRequestId(),
      organizationId,
      subjectEmail: input.subjectEmail,
      subjectCustomerId: input.subjectCustomerId ?? null,
      type: input.type,
      requesterNote: input.requesterNote ?? null,
      createdBy: input.auth.userId ?? 'SUPERVISOR',
      now,
    });

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.requests.save(request, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'INGEST_PRIVACY_REQUEST',
          resource: 'privacy_data_request',
          resourceId: request.id,
          detail: {
            type: request.type,
            subjectEmail: request.subjectEmail,
            // The deadline goes into the audit trail, not just the row: it is
            // the fact a regulator checks first, and it must be readable
            // without joining back to a table that may since have changed.
            dueAt: request.dueAt,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return request;
    });
  };
}
