import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';

export interface CreateCaseInput {
  readonly auth: AuthContext;
  readonly customerId: string;
  readonly riskScore: number;
  readonly priority?: string;
  readonly customerEmail?: string | null;
  readonly bridgeUserId?: string | null;
  readonly bridgeWallet?: string | null;
  readonly stripeCustomerId?: string | null;
  readonly tags?: readonly string[];
}

export interface CreateCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
}

/**
 * T5 — manual case creation (first vertical slice, design "Transaction
 * boundaries: CreateCase (T5)"). Within ONE `unitOfWork.withTransaction`:
 * inserts the `Case` (Status OPEN, no FinturuCacheSnapshot — that field is
 * only ever populated by an automated intake path, out of scope here),
 * appends a `CASE_CREATED` `CaseTimeline` entry, and records a
 * `CREATE_CASE` audit row.
 *
 * TODO(slice 9 — T1 auto-routing): once `RouteCase` exists, invoke it here
 * (still inside this same transaction) to resolve `AssignedTo` from the
 * org's ACTIVE ZEN routing rule.
 * TODO(slice 6 — T2 SLA calculation): once `CalculateSla` exists, invoke it
 * here (still inside this same transaction) to create `CaseSlaTracking`
 * and denormalize `Case.DueDate`. Until then, every case created by this
 * use case has `dueDate: null`.
 */
export function createCreateCaseUseCase(deps: CreateCaseDeps) {
  return async function createCase(input: CreateCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const kase = Case.create({
        id: deps.generateCaseId(),
        organizationId,
        customerId: input.customerId,
        customerEmail: input.customerEmail,
        bridgeUserId: input.bridgeUserId,
        bridgeWallet: input.bridgeWallet,
        stripeCustomerId: input.stripeCustomerId,
        riskScore: createRiskScore(input.riskScore),
        priority: createCasePriority(input.priority ?? 'LOW'),
        tags: input.tags,
        now,
      });

      await deps.cases.save(kase, tx);

      const timelineEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: kase.id,
        eventType: 'CASE_CREATED',
        previousValue: null,
        newValue: kase.status,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(timelineEvent, tx);

      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: input.auth.actorType,
          actorId: input.auth.userId,
          action: 'CREATE_CASE',
          resource: 'case',
          resourceId: kase.id,
          detail: { customerId: kase.customerId, riskScore: kase.riskScore, priority: kase.priority },
          ipAddress: input.auth.ipAddress,
        },
        tx,
      );

      // TODO(slice 9): RouteCase(kase, tx) here.
      // TODO(slice 6): CalculateSla(kase, tx) here.

      return kase;
    });
  };
}
