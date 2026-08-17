import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { OutboxRepository } from '../domain/ports/OutboxRepository.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../domain/model/aggregates/OutboxEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
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
  readonly rawSnapshot: Record<string, unknown>;
}

export interface OpenFraudCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly outbox: OutboxRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
}

export function createOpenFraudCaseUseCase(deps: OpenFraudCaseDeps) {
  return async function openFraudCase(input: OpenFraudCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();
    const riskScore = createRiskScore(input.riskScore ?? 50);
    const priority = createCasePriority(input.priority ?? 'HIGH');
    const tags = Array.isArray(input.tags) && input.tags.length > 0 ? input.tags : ['MANUAL_INVESTIGATION', 'SUSPECTED_FRAUD'];

    return deps.unitOfWork.withTransaction(async (tx) => {
      // Check if a case already exists
      const existing = await deps.cases.findByCustomerOrBridgeId(
        organizationId,
        input.customerId,
        input.bridgeUserId ?? null,
        tx,
      );

      if (existing) {
        // Update snapshot and reopen if closed
        const updated = existing.updateFinturuSnapshot({
          finturuCacheSnapshot: input.rawSnapshot,
          riskScore,
          priority,
          customerEmail: input.customerEmail ?? null,
          bridgeUserId: input.bridgeUserId ?? null,
          bridgeWallet: input.bridgeWallet ?? null,
          stripeCustomerId: input.stripeCustomerId ?? null,
          now,
        });
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

        return updated;
      }

      // Create new case with frozen snapshot
      const kase = Case.create({
        id: deps.generateCaseId(),
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
        tags,
        now,
      });

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
        id: deps.generateTimelineEventId(),
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
      await deps.outbox.record(outboxEvent, tx);

      return kase;
    });
  };
}
