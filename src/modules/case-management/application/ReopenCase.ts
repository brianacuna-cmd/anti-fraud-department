import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import { fromDate, toDate } from '../../../shared/time/Instant.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { CaseSlaTrackingRepository } from '../domain/ports/CaseSlaTrackingRepository.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { CaseSlaTrackingId } from '../domain/model/value-objects/CaseSlaTrackingId.js';
import type { CaseStatus } from '../domain/model/value-objects/CaseStatus.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import { CaseSlaTracking } from '../domain/model/aggregates/CaseSlaTracking.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import {
  caseNotFound,
  forbiddenCrossTenant,
  invariantViolation,
  organizationFraudConfigNotFound,
} from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireRole } from './authorization/requireRole.js';

const MS_PER_MINUTE = 60_000;
const REOPEN_ROLES = ['SUPERVISOR', 'ADMIN'] as const;

export interface ReopenCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly targetStatus: CaseStatus;
  readonly justification: string;
}

export interface ReopenCaseDeps {
  readonly cases: CaseRepository;
  readonly slaTracking: CaseSlaTrackingRepository;
  readonly fraudConfig: OrganizationFraudConfigRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly generateCaseSlaTrackingId: () => CaseSlaTrackingId;
}

/**
 * T6 reopen (PR4). Role-gated to SUPERVISOR|ADMIN via `auth.roleId`.
 * Requires non-empty justification. Soft-deleted cases surface as
 * CASE_NOT_FOUND. Resets CaseSlaTracking when present (or creates one),
 * recomputes dueDate from org fraud config minutes, and records
 * CASE_REOPENED timeline + REOPEN_CASE audit.
 */
export function createReopenCaseUseCase(deps: ReopenCaseDeps) {
  return async function reopenCase(input: ReopenCaseInput): Promise<Case> {
    requireRole(input.auth, REOPEN_ROLES);
    const organizationId = requireTenantContext(input.auth);
    const justification = input.justification.trim();
    if (justification.length === 0) {
      throw invariantViolation('reopen justification is required');
    }
    const caseId = createCaseId(input.caseId);

    return deps.unitOfWork.withTransaction(async (tx) => {
      const existing = await deps.cases.findById(caseId, tx);
      if (existing === null || existing.deletedAt !== null) {
        throw caseNotFound(caseId);
      }
      if (existing.organizationId !== organizationId) {
        throw forbiddenCrossTenant('case does not belong to the actor organization');
      }

      const now = deps.clock.now();
      const previousStatus = existing.status;
      const reopened = existing.reopen(input.targetStatus, now);

      const config = await deps.fraudConfig.findByOrganization(organizationId, tx);
      if (!config) {
        throw organizationFraudConfigNotFound(organizationId);
      }
      const minutes = config.slaMinutesFor(reopened.priority);
      const dueDate = fromDate(new Date(toDate(now).getTime() + minutes * MS_PER_MINUTE));

      const existingTracking = await deps.slaTracking.findByCaseId(reopened.id, tx);
      const tracking =
        existingTracking !== null
          ? existingTracking.reset(dueDate, now)
          : CaseSlaTracking.create({
              id: deps.generateCaseSlaTrackingId(),
              caseId: reopened.id,
              dueDate,
              now,
            });
      await deps.slaTracking.save(tracking, tx);

      const withDue = reopened.withDueDate(dueDate, now);
      await deps.cases.save(withDue, tx);

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: withDue.id,
        eventType: 'CASE_REOPENED',
        previousValue: previousStatus,
        newValue: input.targetStatus,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'REOPEN_CASE',
          resource: 'case',
          resourceId: withDue.id,
          detail: {
            targetStatus: input.targetStatus,
            previousStatus,
            justification,
          },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      return withDue;
    });
  };
}
