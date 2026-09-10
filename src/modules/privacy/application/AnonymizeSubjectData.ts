import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { PrivacyDataRequestId } from '../domain/model/value-objects/PrivacyDataRequestId.js';
import type { PrivacyDataRequestRepository } from '../domain/ports/PrivacyDataRequestRepository.js';
import type { SubjectDataSource } from '../domain/ports/SubjectDataSource.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import { erasureBarredByRetention, privacyRequestNotFound } from '../domain/errors/PrivacyError.js';
import { planErasure, resolutionFor } from '../domain/services/RetentionPolicy.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, PRIVACY_WRITE_ROLES } from './authorization/policy.js';

export interface AnonymizeSubjectDataInput {
  readonly auth: AuthContext;
  readonly requestId: PrivacyDataRequestId;
}

export interface AnonymizeSubjectDataResult {
  /** How many records had their identity fields masked. */
  readonly maskedCount: number;
  /** Records kept intact because a legal duty required it. */
  readonly barred: readonly { readonly id: string; readonly retainedUntil: Instant | null }[];
  readonly barredUntil: Instant | null;
  readonly bases: readonly string[];
  /** What PRIV-004 should record as the outcome. */
  readonly suggestedResolution: 'FULFILLED' | 'PARTIALLY_FULFILLED';
}

export interface AnonymizeSubjectDataDeps {
  readonly requests: PrivacyDataRequestRepository;
  readonly subjectData: SubjectDataSource;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

/**
 * PRIV-003: masks the subject's identity fields, keeping what the law says
 * must be kept.
 *
 * This is the operation where two obligations point in opposite directions,
 * and the resolution is not a compromise — it is that they apply to different
 * FIELDS. The subject's name, email and phone identify a person and go; the
 * amounts, dates and decisions are the antilaundering trail and stay. A
 * record stripped of its identity fields still proves a transaction happened
 * and still cannot be traced back to the person, which is exactly what both
 * regimes ask for.
 *
 * Nothing is masked outside the transaction, and the audit entry is written
 * in the same one. An anonymization is irreversible: if the record of what
 * was destroyed can be lost while the destruction survives, the tenant is
 * left unable to prove it acted lawfully.
 */
export function createAnonymizeSubjectDataUseCase(deps: AnonymizeSubjectDataDeps) {
  return async function anonymizeSubjectData(
    input: AnonymizeSubjectDataInput,
  ): Promise<AnonymizeSubjectDataResult> {
    requireOperationalRole(input.auth, PRIVACY_WRITE_ROLES);
    const organizationId = requireTenantContext(input.auth);

    const request = await deps.requests.findById(input.requestId);
    if (request === null || request.organizationId !== organizationId) {
      throw privacyRequestNotFound(input.requestId);
    }

    const now = deps.clock.now();
    const records = await deps.subjectData.findRecords(organizationId, {
      email: request.subjectEmail,
      customerId: request.subjectCustomerId,
    });
    const plan = planErasure(records, now);

    /*
     * Everything is barred: refuse, but refuse with the reason.
     *
     * This is a distinct outcome from "erased nothing because there was
     * nothing" — which succeeds trivially — and the subject is owed the
     * difference. The error carries the basis and the date so the answer can
     * be "not until 2029, because of antilaundering retention" rather than a
     * bare failure.
     */
    if (plan.erasable.length === 0 && plan.barred.length > 0) {
      throw erasureBarredByRetention(
        request.subjectEmail,
        plan.bases.join(', ') || 'legal retention duty',
        plan.barredUntil,
      );
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const maskedCount = await deps.subjectData.maskRecords(
        organizationId,
        plan.erasable.map((r) => r.id),
        tx,
      );

      await deps.requests.save(request.start(now), tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'ANONYMIZE_SUBJECT_DATA',
          resource: 'subject_data',
          resourceId: request.id,
          detail: {
            subjectEmail: request.subjectEmail,
            maskedCount,
            maskedIds: plan.erasable.map((r) => r.id),
            // What was NOT erased matters more than what was: it is the half
            // the tenant has to justify if the subject complains.
            barredIds: plan.barred.map((r) => r.id),
            barredUntil: plan.barredUntil,
            retentionBases: plan.bases,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return {
        maskedCount,
        barred: plan.barred.map((r) => ({ id: r.id, retainedUntil: r.retainedUntil })),
        barredUntil: plan.barredUntil,
        bases: plan.bases,
        suggestedResolution: resolutionFor(plan),
      };
    });
  };
}
