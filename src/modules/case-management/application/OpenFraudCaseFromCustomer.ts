import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
import { createAssignedTo, type AssignedTo } from '../domain/model/value-objects/AssignedTo.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface OpenFraudCaseInput {
  readonly auth: AuthContext;
  readonly customerId: string;
  readonly customerEmail?: string | null;
  readonly bridgeUserId?: string | null;
  readonly bridgeWallet?: string | null;
  readonly stripeCustomerId?: string | null;
  readonly riskScore?: number;
  readonly priority?: string;
  readonly reason?: string;
  readonly tags?: readonly string[];
  readonly assignedTo?: { readonly type: string; readonly id: string } | null;
  readonly autoAssignToMe?: boolean;
  readonly rawSnapshot: Record<string, unknown>;
}

export interface OpenFraudCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly generateOutboxEventId: () => OutboxEventId;
  readonly auditRecorder: AuditRecorder;
  readonly initializeCaseSla: InitializeCaseSlaService;
}

export function createOpenFraudCaseUseCase(deps: OpenFraudCaseDeps) {
  return async function openFraudCase(input: OpenFraudCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();
    const riskScore = createRiskScore(input.riskScore ?? 50);
    const priority = createCasePriority(input.priority ?? 'HIGH');
    const tags = Array.isArray(input.tags) && input.tags.length > 0 ? input.tags : ['MANUAL_INVESTIGATION', 'SUSPECTED_FRAUD'];

    let assignedTo: AssignedTo | null = null;
    if (input.assignedTo?.id && input.assignedTo?.type) {
      assignedTo = createAssignedTo(input.assignedTo.type, input.assignedTo.id);
    } else if (input.autoAssignToMe && input.auth.actorType === 'USER' && input.auth.userId) {
      // Only a USER actor has a "me" to assign to. For ORGANIZATION,
      // `auth.userId` carries the organization id (the resolver fills it
      // that way because the field does not allow null), and assigning it
      // as if it were a user left the case pointing at someone who does
      // not exist.
      assignedTo = createAssignedTo('USER', input.auth.userId);
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      // Check if a case already exists
      // Without `statuses`: unlike webhook ingestion, opening a case by
      // hand on a customer with a closed case must reopen that one, not
      // create a parallel one. That is the path that exercises `CASE_REOPENED`
      // below.
      const existing = await deps.cases.findByCustomerOrBridgeId(
        {
          organizationId,
          customerId: input.customerId,
          bridgeUserId: input.bridgeUserId ?? null,
        },
        tx,
      );

      if (existing) {
        // Update snapshot and reopen if closed
        let updated = existing.updateFinturuSnapshot({
          finturuCacheSnapshot: input.rawSnapshot,
          riskScore,
          priority,
          customerEmail: input.customerEmail ?? null,
          bridgeUserId: input.bridgeUserId ?? null,
          bridgeWallet: input.bridgeWallet ?? null,
          stripeCustomerId: input.stripeCustomerId ?? null,
          now,
        });
        if (assignedTo !== null && (!existing.assignedTo || existing.assignedTo.id !== assignedTo.id)) {
          updated = updated.reassign(assignedTo, now);
        }

        // CASE-009: reopening restarts the clock. Without this a case that
        // returns to the inbox would drag the `dueDate` of the previous cycle —
        // usually already overdue — and would be born already failing its own SLA.
        const reopenDueDate = await deps.initializeCaseSla({
          organizationId,
          caseId: existing.id,
          priority: updated.priority,
          now,
          tx,
        });
        updated = updated.withDueDate(reopenDueDate, now);

        await deps.cases.save(updated, tx);

        // Record timeline event for analyst investigation
        const timelineEvent = CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: existing.id,
          eventType: 'CASE_REOPENED',
          previousValue: existing.status,
          newValue: 'OPEN',
          createdBy: input.auth.userId ?? 'ANALYST',
          createdAt: now,
        });
        await deps.timelineRecorder.record(timelineEvent, tx);

        if (assignedTo !== null) {
          const assignEvent = CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: existing.id,
            eventType: 'ASSIGNED',
            previousValue: existing.assignedTo ? `${existing.assignedTo.type}:${existing.assignedTo.id}` : null,
            newValue: `${assignedTo.type}:${assignedTo.id}`,
            createdBy: input.auth.userId ?? 'ANALYST',
            createdAt: now,
          });
          await deps.timelineRecorder.record(assignEvent, tx);
        }

        return updated;
      }

      // Create new case with frozen snapshot
      const caseId = deps.generateCaseId();

      const dueDate = await deps.initializeCaseSla({
        organizationId,
        caseId,
        priority,
        now,
        tx,
      });

      const kase = Case.create({
        id: caseId,
        organizationId,
        customerId: input.customerId,
        customerEmail: input.customerEmail ?? null,
        bridgeUserId: input.bridgeUserId ?? null,
        bridgeWallet: input.bridgeWallet ?? null,
        stripeCustomerId: input.stripeCustomerId ?? null,
        finturuReference: null,
        finturuCacheSnapshot: input.rawSnapshot,
        riskScore,
        priority,
        assignedTo,
        tags,
        now,
      }).withDueDate(dueDate, now);

      await deps.cases.save(kase, tx);

      // Record legitimate CASE_CREATED timeline event
      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: kase.id,
        eventType: 'CASE_CREATED',
        previousValue: null,
        newValue: 'OPEN',
        createdBy: input.auth.userId ?? 'ANALYST',
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      if (assignedTo !== null) {
        const assignEvent = CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: kase.id,
          eventType: 'ASSIGNED',
          previousValue: null,
          newValue: `${assignedTo.type}:${assignedTo.id}`,
          createdBy: input.auth.userId ?? 'ANALYST',
          createdAt: now,
        });
        await deps.timelineRecorder.record(assignEvent, tx);
      }

      // Record Audit Log
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId ?? 'analyst',
          action: 'CREATE_CASE',
          resource: 'case',
          resourceId: kase.id,
          detail: {
            source: 'ANALYST_INVESTIGATION',
            reason: input.reason ?? 'Caso de fraude abierto por sospecha',
            customerId: kase.customerId,
            riskScore: kase.riskScore,
            priority: kase.priority,
            bridgeUserId: kase.bridgeUserId,
            bridgeWallet: kase.bridgeWallet,
            stripeCustomerId: kase.stripeCustomerId,
          },
          ipAddress: null,
        },
        tx,
      );

      // Record Outbox Event
      const outboxEvent = OutboxEvent.create({
        id: deps.generateOutboxEventId(),
        organizationId: kase.organizationId,
        aggregateType: 'Case',
        aggregateId: kase.id,
        eventType: 'case.created',
        payload: {
          caseId: kase.id,
          organizationId: kase.organizationId,
          customerId: kase.customerId,
          customerEmail: kase.customerEmail,
          riskScore: kase.riskScore,
          status: kase.status,
          priority: kase.priority,
          createdAt: kase.createdAt,
        },
        now,
      });
      await deps.outbox.save(outboxEvent, tx);

      return kase;
    });
  };
}
