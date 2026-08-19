import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import type { RouteCaseService } from './RouteCase.js';
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
  readonly initializeCaseSla: InitializeCaseSlaService;
  /** Opcional: sin el, el caso nace sin asignar (bandeja general). */
  readonly routeCase?: RouteCaseService;
}

/**
 * T5 — manual case creation (first vertical slice, design "Transaction
 * boundaries: CreateCase (T5)"). Within ONE `unitOfWork.withTransaction`:
 * inserts the `Case` (Status OPEN, no FinturuCacheSnapshot — that field is
 * only ever populated by an automated intake path, out of scope here),
 * appends a `CASE_CREATED` `CaseTimeline` entry, and records a
 * `CREATE_CASE` audit row.
 *
 * CASE-003 runs in the same transaction: `initializeCaseSla` writes the
 * `CaseSlaTracking` row and returns the deadline, which is denormalized onto
 * `Case.DueDate` before the single `save`. Doing it before the save keeps
 * this to one write per aggregate rather than an insert followed by an
 * update.
 *
 * CASE-002 tambien corre aqui dentro: `routeCase` resuelve el responsable
 * contra las reglas activas del inquilino ANTES de construir el agregado, de
 * modo que el expediente nace ya asignado en vez de aparecer un instante en la
 * bandeja general y moverse despues.
 */
export function createCreateCaseUseCase(deps: CreateCaseDeps) {
  return async function createCase(input: CreateCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      const caseId = deps.generateCaseId();
      const priority = createCasePriority(input.priority ?? 'LOW');

      const dueDate = await deps.initializeCaseSla({
        organizationId,
        caseId,
        priority,
        now,
        tx,
      });

      const routed = deps.routeCase
        ? await deps.routeCase({
            organizationId,
            kase: {
              riskScore: createRiskScore(input.riskScore),
              priority,
              tags: input.tags ?? [],
              customerEmail: input.customerEmail,
              stripeCustomerId: input.stripeCustomerId,
              bridgeWallet: input.bridgeWallet,
            },
            tx,
          })
        : null;

      const kase = Case.create({
        id: caseId,
        organizationId,
        customerId: input.customerId,
        customerEmail: input.customerEmail,
        bridgeUserId: input.bridgeUserId,
        bridgeWallet: input.bridgeWallet,
        stripeCustomerId: input.stripeCustomerId,
        riskScore: createRiskScore(input.riskScore),
        priority,
        assignedTo: routed?.assignedTo ?? null,
        tags: input.tags,
        now,
      }).withDueDate(dueDate, now);

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

      const slaEvent = CaseTimelineEvent.create({
        id: deps.generateTimelineEventId(),
        caseId: kase.id,
        eventType: 'SLA_INITIALIZED',
        previousValue: null,
        newValue: dueDate,
        createdBy: input.auth.userId,
        createdAt: now,
      });
      await deps.timelineRecorder.record(slaEvent, tx);

      if (routed?.assignedTo) {
        await deps.timelineRecorder.record(
          CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: kase.id,
            eventType: 'ROUTED',
            previousValue: routed.ruleName,
            newValue: `${routed.assignedTo.type}:${routed.assignedTo.id}`,
            createdBy: input.auth.userId,
            createdAt: now,
          }),
          tx,
        );
      }

      return kase;
    });
  };
}
