import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';
import { requireOperationalRole, CASE_WORK_ROLES } from './authorization/policy.js';
import { loadWorkableCase } from './loadWorkableCase.js';
import { beginReviewOnWork } from './beginReviewOnWork.js';

export interface RequestCaseDocumentationInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  /** What was asked of the customer, in the analyst's words. */
  readonly requestedDocuments: string;
}

export interface RequestCaseDocumentationDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
}

/**
 * Parks a case IN_REVIEW -> PENDING_DOCUMENTATION while the customer is
 * asked for supporting documents (an OPEN case enters review first, see
 * `beginReviewOnWork`),
 * ANALYST|SUPERVISOR only.
 *
 * The SLA is NOT paused: the deadline keeps running while the case waits, so
 * nothing here touches `CaseSlaTracking` or `dueDate`.
 *
 * Within ONE transaction: transition + STATE_CHANGED timeline +
 * DOCUMENTATION_REQUESTED timeline (carrying what was asked, so the case file
 * shows it without reading the audit log) + REQUEST_CASE_DOCUMENTATION audit.
 */
export function createRequestCaseDocumentationUseCase(deps: RequestCaseDocumentationDeps) {
  return async function requestCaseDocumentation(input: RequestCaseDocumentationInput): Promise<Case> {
    requireOperationalRole(input.auth, CASE_WORK_ROLES);
    const requestedDocuments = input.requestedDocuments.trim();
    if (requestedDocuments.length === 0) {
      throw invariantViolation('requestedDocuments must be a non-empty string', { field: 'requestedDocuments' });
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      const loaded = await loadWorkableCase(deps.cases, input, tx);
      const { organizationId } = loaded;
      const existing = await beginReviewOnWork(deps, loaded.existing, input.auth, 'REQUEST_CASE_DOCUMENTATION', tx);

      const now = deps.clock.now();
      const previousStatus = existing.status;
      const pending = existing.transitionTo('PENDING_DOCUMENTATION', now);
      await deps.cases.save(pending, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: pending.id,
          eventType: 'STATE_CHANGED',
          previousValue: previousStatus,
          newValue: 'PENDING_DOCUMENTATION',
          createdBy: input.auth.userId,
          createdAt: now,
        }),
        tx,
      );
      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: pending.id,
          eventType: 'DOCUMENTATION_REQUESTED',
          previousValue: null,
          newValue: requestedDocuments,
          createdBy: input.auth.userId,
          createdAt: now,
        }),
        tx,
      );

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REQUEST_CASE_DOCUMENTATION',
          resource: 'case',
          resourceId: pending.id,
          detail: { previousStatus, requestedDocuments },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return pending;
    });
  };
}
