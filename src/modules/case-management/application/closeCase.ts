import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { Case } from '../domain/model/aggregates/Case.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { ResolutionRepository } from '../domain/ports/ResolutionRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { Instant } from '../../../shared/time/Instant.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { ResolutionId } from '../domain/model/value-objects/ResolutionId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { CaseManagementAuditAction } from '../domain/model/value-objects/CaseManagementAuditVocabulary.js';
import type { ResolutionClosureType } from '../domain/model/aggregates/Resolution.js';
import { Resolution } from '../domain/model/aggregates/Resolution.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { createCaseId } from '../domain/model/value-objects/CaseId.js';
import { caseNotFound, forbiddenCrossTenant } from '../domain/errors/CaseManagementError.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { requireOperationalRole, SUPERVISION_ROLES } from './authorization/policy.js';

export interface CloseCaseInput {
  readonly auth: AuthContext;
  readonly caseId: string;
  readonly reason: string;
}

export interface CloseCaseDeps {
  readonly cases: CaseRepository;
  readonly resolutions: ResolutionRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly auditRecorder: AuditRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateResolutionId: () => ResolutionId;
  readonly generateTimelineEventId: () => TimelineEventId;
  /** Required only when `config.outboxEventType` is set (resolve path). */
  readonly outbox?: OutboxEventRepository;
  readonly generateOutboxEventId?: () => OutboxEventId;
}

export interface CloseCaseConfig {
  readonly closureType: ResolutionClosureType;
  readonly auditAction: CaseManagementAuditAction;
  /** When set, stop the SLA (clear the case dueDate read-model) on closure. */
  readonly stopSla?: boolean;
  /** When set, emit an `outbox_events` row of this type in the same transaction. */
  readonly outboxEventType?: string;
}

/**
 * Shared closure routine for resolve/archive (case-lifecycle-core PR3).
 * SUPERVISOR only. Within ONE `unitOfWork.withTransaction`: transition
 * the case (throws `invalidTransition`/422 if the edge is illegal), append a
 * `Resolution` row (1:N, historical — reopen never voids it), record a
 * `STATE_CHANGED` timeline event, and audit. Case status finally gets a
 * `transitionTo` caller.
 */
export function closeCase(deps: CloseCaseDeps, config: CloseCaseConfig) {
  const { closureType, auditAction } = config;
  return async function close(input: CloseCaseInput): Promise<Case> {
    requireOperationalRole(input.auth, SUPERVISION_ROLES);
    const organizationId = requireTenantContext(input.auth);
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
      const transitioned = existing.transitionTo(closureType, now);
      // Stop the SLA: clear the case dueDate read-model so a closed case no
      // longer surfaces an active SLA (task scope: cases, not case_sla_tracking).
      const closed = config.stopSla === true ? transitioned.withDueDate(null, now) : transitioned;
      await deps.cases.save(closed, tx);

      const resolution = Resolution.create({
        id: deps.generateResolutionId(),
        caseId,
        organizationId,
        closureType,
        reason: input.reason,
        resolvedBy: input.auth.userId,
        now,
      });
      await deps.resolutions.save(resolution, tx);

      await deps.timelineRecorder.record(
        CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId,
          eventType: 'STATE_CHANGED',
          previousValue: previousStatus,
          newValue: closureType,
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
          action: auditAction,
          resource: 'case',
          resourceId: caseId,
          detail: { closureType, reason: resolution.reason, resolutionId: resolution.id },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      if (config.outboxEventType !== undefined) {
        await emitOutbox(deps, config.outboxEventType, tx, {
          organizationId,
          caseId,
          closureType,
          resolutionId: resolution.id,
          resolvedBy: input.auth.userId,
          now,
        });
      }

      return closed;
    });
  };
}

interface OutboxContext {
  readonly organizationId: string;
  readonly caseId: string;
  readonly closureType: ResolutionClosureType;
  readonly resolutionId: string;
  readonly resolvedBy: string;
  readonly now: Instant;
}

async function emitOutbox(
  deps: CloseCaseDeps,
  eventType: string,
  tx: Transaction,
  ctx: OutboxContext,
): Promise<void> {
  if (deps.outbox === undefined || deps.generateOutboxEventId === undefined) {
    throw new Error('closeCase: outbox event requested but outbox deps are not wired');
  }
  await deps.outbox.save(
    OutboxEvent.create({
      id: deps.generateOutboxEventId(),
      organizationId: ctx.organizationId,
      eventType,
      aggregateType: 'cases',
      aggregateId: ctx.caseId,
      payload: {
        case_id: ctx.caseId,
        organization_id: ctx.organizationId,
        closure_type: ctx.closureType,
        resolution_id: ctx.resolutionId,
        resolved_by: ctx.resolvedBy,
      },
      now: ctx.now,
    }),
    tx,
  );
}
