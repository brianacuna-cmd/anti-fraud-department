import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork, Transaction } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import type { RouteCaseInput } from './RouteCase.js';
import type { CalculateSlaInput } from './CalculateSla.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';
import { requireTenantContext } from './authorization/requireTenantContext.js';
import { isDuplicateKeyError } from '../../../shared/persistence/mongo/duplicateKey.js';

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
  /**
   * Optional evidence freeze for automated score→case opens.
   * Manual `POST /cases` omits this; Case stores `null`.
   */
  readonly finturuCacheSnapshot?: Record<string, unknown> | null;
  /**
   * Optional external idempotency key (RF-1/RF-2). Absent/blank = today's
   * exact behavior. When present and non-blank, a second call with the same
   * key (same org) returns the already-persisted Case instead of creating a
   * duplicate — see the in-tx short-circuit below.
   */
  readonly idempotencyKey?: string | null;
}

export interface CreateCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  /**
   * T1 auto-routing (CASE-002), invoked inside this use case's transaction so
   * the assignment + its `ASSIGNED` timeline event commit atomically with the
   * new case. Injected as the composed `RouteCase` use case to keep CreateCase
   * decoupled from routing's own dependencies (rules repo, ZEN engine).
   */
  readonly routeCase: (input: RouteCaseInput) => Promise<Case>;
  /**
   * T2 SLA calculation — runs after `routeCase` inside the same transaction.
   * Fail-closed when OrganizationFraudConfig is missing.
   */
  readonly calculateSla: (input: CalculateSlaInput) => Promise<Case>;
}

/**
 * Manual + automated case creation. Within ONE `unitOfWork.withTransaction`:
 * inserts the `Case` (Status OPEN; `finturuCacheSnapshot` optional — set by
 * the composition score→case orchestrator, omitted/null on manual POST /cases),
 * appends a `CASE_CREATED` `CaseTimeline` entry, and records a
 * `CREATE_CASE` audit row.
 *
 * T1 auto-routing (CASE-002): after the case is persisted, `RouteCase` runs
 * inside this same transaction — it evaluates the org's ACTIVE ZEN routing
 * rules against the case and, on the first match, sets `AssignedTo` and
 * appends an `ASSIGNED` timeline event.
 *
 * T2 SLA: after routing, `CalculateSla` sets `dueDate` + ON_TRACK
 * `CaseSlaTracking` inside the same transaction (fail-closed without fraud config).
 */
export function createCreateCaseUseCase(deps: CreateCaseDeps) {
  return async function createCase(input: CreateCaseInput): Promise<Case> {
    const organizationId = requireTenantContext(input.auth);
    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      // Idempotency (RF-1/RF-2/RF-3, design D2): normalize first — blank/
      // whitespace-only keys are treated as absent (today's exact behavior).
      const normalizedKey = input.idempotencyKey?.trim();
      const idempotencyKey = normalizedKey !== undefined && normalizedKey.length > 0 ? normalizedKey : null;

      if (idempotencyKey !== null) {
        const existing = await deps.cases.findByIdempotencyKey(organizationId, idempotencyKey, tx);
        if (existing !== null) {
          return existing;
        }
      }

      try {
        return await createAndRoute(deps, input, organizationId, now, idempotencyKey, tx);
      } catch (err) {
        // Concurrency backstop (design D3, ADR-2 LOCKED): two racing retries
        // both miss the short-circuit read above; the loser's insert hits the
        // unique partial index (E11000) — re-read and return the winner
        // instead of surfacing a transient failure.
        if (idempotencyKey !== null && isDuplicateKeyError(err)) {
          const winner = await deps.cases.findByIdempotencyKey(organizationId, idempotencyKey, tx);
          if (winner !== null) {
            return winner;
          }
        }
        throw err;
      }
    });
  };
}

async function createAndRoute(
  deps: CreateCaseDeps,
  input: CreateCaseInput,
  organizationId: string,
  now: ReturnType<Clock['now']>,
  idempotencyKey: string | null,
  tx: Transaction,
): Promise<Case> {
  const kase = Case.create({
    id: deps.generateCaseId(),
    organizationId,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    bridgeUserId: input.bridgeUserId,
    bridgeWallet: input.bridgeWallet,
    stripeCustomerId: input.stripeCustomerId,
    finturuCacheSnapshot: input.finturuCacheSnapshot,
    idempotencyKey,
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

  // T1 auto-routing (CASE-002): evaluate the org's ACTIVE routing rules and,
  // on the first match, assign the case + append an ASSIGNED timeline event
  // — all inside this same transaction. `createdBy: null` because the rule,
  // not the caller, chose the assignee; actorType/ipAddress still carry the
  // request's audit attribution.
  const routed = await deps.routeCase({
    kase,
    tx,
    createdBy: null,
    actorType: input.auth.actorType,
    ipAddress: input.auth.ipAddress,
  });

  return deps.calculateSla({ kase: routed, tx });
}
