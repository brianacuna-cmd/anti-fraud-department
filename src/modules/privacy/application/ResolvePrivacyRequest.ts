import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { PrivacyDataRequest } from '../domain/model/aggregates/PrivacyDataRequest.js';
import type { PrivacyDataRequestId } from '../domain/model/value-objects/PrivacyDataRequestId.js';
import type { PrivacyResolution } from '../domain/model/value-objects/PrivacyRequestStatus.js';
import type { PrivacyDataRequestRepository } from '../domain/ports/PrivacyDataRequestRepository.js';
import type { CertificateIssuer } from '../domain/ports/CertificateIssuer.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { privacyRequestNotFound } from '../domain/errors/PrivacyError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, PRIVACY_WRITE_ROLES } from './authorization/policy.js';

export interface ResolvePrivacyRequestInput {
  readonly auth: AuthContext;
  readonly requestId: PrivacyDataRequestId;
  readonly resolution: PrivacyResolution;
  readonly note: string;
}

export interface ResolvePrivacyRequestResult {
  readonly request: PrivacyDataRequest;
  /** The constancia to send to the subject. Returned once, never stored whole. */
  readonly certificate: string;
}

export interface ResolvePrivacyRequestDeps {
  readonly requests: PrivacyDataRequestRepository;
  readonly certificates: CertificateIssuer;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * PRIV-004: closes the request with a formal answer and its certificate.
 *
 * The certificate document is returned to the caller but only its hash is
 * persisted. Storing the full text would create a third copy of the subject's
 * details — after the case record and the audit entry — in a table whose
 * whole purpose is handling requests to hold fewer copies. The hash is enough
 * to prove that the constancia the subject holds is the one that was issued,
 * and the document itself can be re-rendered from the request whenever it is
 * needed again.
 *
 * Notifying the subject is deliberately NOT done here. Sending mail is a
 * side effect that can fail long after the transaction commits, and a
 * resolution that rolls back because an SMTP server was down would leave the
 * tenant's deadline running. The notification belongs to a consumer of the
 * audit/outbox trail, not to this transaction.
 */
export function createResolvePrivacyRequestUseCase(deps: ResolvePrivacyRequestDeps) {
  return async function resolvePrivacyRequest(
    input: ResolvePrivacyRequestInput,
  ): Promise<ResolvePrivacyRequestResult> {
    requireOperationalRole(input.auth, PRIVACY_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const existing = await deps.requests.findById(input.requestId);
    if (existing === null || existing.organizationId !== organizationId) {
      throw privacyRequestNotFound(input.requestId);
    }

    const now = deps.clock.now();
    const certificate = deps.certificates.issue({
      requestId: existing.id,
      subjectEmail: existing.subjectEmail,
      type: existing.type,
      resolution: input.resolution,
      note: input.note,
      resolvedAtIso: now,
    });

    const resolved = existing.resolve({
      resolution: input.resolution,
      note: input.note,
      certificateHash: certificate.sha256,
      resolvedBy: input.auth.userId ?? 'SUPERVISOR',
      now,
    });

    return deps.unitOfWork.withTransaction(async (tx) => {
      await deps.requests.save(resolved, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'RESOLVE_PRIVACY_REQUEST',
          resource: 'privacy_data_request',
          resourceId: resolved.id,
          detail: {
            type: resolved.type,
            resolution: resolved.resolution,
            certificateSha256: resolved.certificateHash,
            // Whether the tenant met its own deadline, decided at the moment
            // of resolving. Recomputing it later against a changed rule would
            // rewrite history.
            withinDeadline: !existing.isOverdue(now),
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return { request: resolved, certificate: certificate.document };
    });
  };
}
