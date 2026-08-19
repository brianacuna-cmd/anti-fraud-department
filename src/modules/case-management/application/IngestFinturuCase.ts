import type { Clock } from '../../../shared/time/Clock.js';
import { ACTIVE_CASE_STATUSES } from '../domain/ports/CaseRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import type { RouteCaseService } from './RouteCase.js';
import type { OutboxRepository } from '../domain/ports/OutboxRepository.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../domain/model/aggregates/OutboxEvent.js';
import { createRiskScore } from '../domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../domain/model/value-objects/CasePriority.js';

export interface IngestFinturuCaseInput {
  readonly rawPayload: Record<string, unknown>;
  readonly organizationId?: string;
  readonly defaultOrganizationId?: string;
  readonly ipAddress?: string;
  readonly recordTimeline?: boolean;
}

export interface IngestFinturuCaseDeps {
  readonly cases: CaseRepository;
  readonly timelineRecorder: TimelineRecorder;
  readonly outbox: OutboxRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  readonly initializeCaseSla: InitializeCaseSlaService;
  /** Opcional: sin el, el caso nace sin asignar (bandeja general). */
  readonly routeCase?: RouteCaseService;
}

export interface IngestFinturuCaseResult {
  readonly case: Case;
  readonly outboxEventId: string;
}

function extractString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function resolvePriorityFromRiskScore(riskScore: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (riskScore >= 80) return 'CRITICAL';
  if (riskScore >= 60) return 'HIGH';
  if (riskScore >= 30) return 'MEDIUM';
  return 'LOW';
}

/**
 * Webhook Ingestion Use Case for Finturu consolidated payload (Bridge, Stripe, Coinflow).
 * Atomically writes to 4 collections:
 * 1. Cases (Status: OPEN, FinturuCacheSnapshot: raw payload, RiskScore, Bridge/Stripe IDs)
 * 2. CaseTimeline (CASE_CREATED event)
 * 3. AuditLogs (CASE_INGESTED_WEBHOOK audit record)
 * 4. OutboxEvents (case.created transactional event with status PENDING)
 */
export function createIngestFinturuCaseUseCase(deps: IngestFinturuCaseDeps) {
  return async function ingestFinturuCase(input: IngestFinturuCaseInput): Promise<IngestFinturuCaseResult> {
    const raw = input.rawPayload;

    // 1. Resolve OrganizationId
    const explicitOrgId =
      extractString(raw, ['organization_id', 'organizationId', 'orgId', 'organizationSlug', 'organization_slug']) ??
      input.organizationId ??
      input.defaultOrganizationId;

    const organizationId = explicitOrgId && explicitOrgId.trim().length > 0 ? explicitOrgId.trim() : 'finturu-org';

    // 2. Extract Customer ID (idUser, customer_id, customerId, etc.)
    const customerId =
      extractString(raw, ['idUser', 'customer_id', 'customerId', 'userId']) ??
      (typeof raw.customer === 'object' && raw.customer !== null
        ? extractString(raw.customer as Record<string, unknown>, ['idUser', 'id', 'customerId'])
        : null) ??
      `cust_${Date.now()}`;

    // 3. Extract Bridge User ID (idUserBridge, bridge_user_id, bridgeUserId, etc.)
    const bridgeUserId =
      extractString(raw, ['idUserBridge', 'bridge_user_id', 'bridgeUserId', 'bridgeCustomerId', 'customerIdBridge']) ??
      (typeof raw.bridge === 'object' && raw.bridge !== null
        ? extractString(raw.bridge as Record<string, unknown>, ['idUserBridge', 'user_id', 'userId', 'customerId'])
        : null) ??
      (typeof raw.customer === 'object' && raw.customer !== null
        ? extractString(raw.customer as Record<string, unknown>, ['idUserBridge'])
        : null);

    // 4. Extract Bridge Wallet (address, bridge_wallet, bridgeWallet, idWallet, etc.)
    let bridgeWallet =
      extractString(raw, ['address', 'bridge_wallet', 'bridgeWallet', 'walletBridge', 'idWallet', 'walletAddress']) ??
      (typeof raw.wallet === 'object' && raw.wallet !== null
        ? extractString(raw.wallet as Record<string, unknown>, ['address', 'idWallet'])
        : null) ??
      (typeof raw.bridge === 'object' && raw.bridge !== null
        ? extractString(raw.bridge as Record<string, unknown>, ['wallet', 'address', 'wallet_address', 'idWallet'])
        : null);

    if (!bridgeWallet && Array.isArray(raw.wallets) && raw.wallets.length > 0) {
      const firstWallet = raw.wallets[0];
      if (typeof firstWallet === 'object' && firstWallet !== null) {
        bridgeWallet = extractString(firstWallet as Record<string, unknown>, ['address', 'idWallet']);
      }
    }

    // 5. Extract Stripe Customer ID (idCustomer, stripe_customer_id, stripeCustomerId, etc.)
    const stripeCustomerId =
      extractString(raw, ['idCustomer', 'stripe_customer_id', 'stripeCustomerId', 'stripeId']) ??
      (typeof raw.stripe === 'object' && raw.stripe !== null
        ? extractString(raw.stripe as Record<string, unknown>, ['idCustomer', 'customer_id', 'customerId'])
        : null);

    // 6. Extract Customer Email
    const customerEmail =
      extractString(raw, ['email', 'customer_email', 'customerEmail']) ??
      (typeof raw.customer === 'object' && raw.customer !== null
        ? extractString(raw.customer as Record<string, unknown>, ['email'])
        : null) ??
      (typeof raw.stripe === 'object' && raw.stripe !== null
        ? extractString(raw.stripe as Record<string, unknown>, ['email'])
        : null);

    // 7. Calculate Risk Score and Priority
    const rawRiskScore = raw.risk_score ?? raw.riskScore;
    const numericScore = typeof rawRiskScore === 'number' && !Number.isNaN(rawRiskScore) ? Math.min(100, Math.max(0, rawRiskScore)) : 50;
    const riskScore = createRiskScore(numericScore);

    const explicitPriority = extractString(raw, ['priority']);
    const priority = createCasePriority(explicitPriority ?? resolvePriorityFromRiskScore(numericScore));

    const now = deps.clock.now();

    return deps.unitOfWork.withTransaction(async (tx) => {
      // 0. Check if a case already exists for this customer or bridge user
      // CASE-011: solo un expediente ACTIVO deduplica. Antes la búsqueda no
      // miraba el estado, así que un caso ya RESOLVED o ARCHIVED absorbía la
      // reincidencia: el cliente volvía a ser reportado y, en vez de abrirse un
      // expediente nuevo, se sobrescribía el snapshot del que ya estaba cerrado.
      const existingCase = await deps.cases.findByCustomerOrBridgeId(
        {
          organizationId,
          customerId,
          bridgeUserId,
          statuses: ACTIVE_CASE_STATUSES,
        },
        tx,
      );

      if (existingCase) {
        const updatedCase = existingCase.updateFinturuSnapshot({
          finturuCacheSnapshot: raw,
          riskScore,
          priority,
          customerEmail,
          bridgeUserId,
          bridgeWallet,
          stripeCustomerId,
          now,
        });

        // CASE-007: la fecha límite depende de la prioridad, así que una
        // reincidencia que sube el riesgo tiene que acortar el reloj. Si la
        // prioridad no se movió, se deja el `dueDate` original: reiniciarlo en
        // cada refresco de snapshot regalaría tiempo indefinidamente y el SLA
        // dejaría de significar nada.
        let recomputed = updatedCase;
        if (updatedCase.priority !== existingCase.priority) {
          const dueDate = await deps.initializeCaseSla({
            organizationId,
            caseId: updatedCase.id,
            priority: updatedCase.priority,
            now,
            tx,
          });
          recomputed = updatedCase.withDueDate(dueDate, now);
        }

        await deps.cases.save(recomputed, tx);

        // El hito en la línea de tiempo es parte del contrato de CASE-011: sin
        // él, una reincidencia sobre un expediente abierto se absorbía en
        // silencio y el analista no tenía forma de saber que Finturu había
        // vuelto a reportar al mismo cliente.
        if (input.recordTimeline !== false) {
          const resnapshotEvent = CaseTimelineEvent.create({
            id: deps.generateTimelineEventId(),
            caseId: recomputed.id,
            eventType: 'SNAPSHOT_REFRESHED',
            previousValue: existingCase.riskScore.toString(),
            newValue: recomputed.riskScore.toString(),
            createdBy: 'SYSTEM_WEBHOOK',
            createdAt: now,
          });
          await deps.timelineRecorder.record(resnapshotEvent, tx);
        }

        const updateOutboxEventId = deps.generateTimelineEventId();
        await deps.outbox.record(
          OutboxEvent.create({
            id: updateOutboxEventId,
            aggregateType: 'case',
            aggregateId: recomputed.id,
            eventType: 'case.snapshot_refreshed',
            payload: {
              caseId: recomputed.id,
              organizationId,
              customerId: recomputed.customerId,
              riskScore: recomputed.riskScore,
              priority: recomputed.priority,
            },
            now,
          }),
          tx,
        );

        return {
          case: recomputed,
          outboxEventId: updateOutboxEventId,
        };
      }

      // 1. Create Case Aggregate with snapshot
      const caseId = deps.generateCaseId();

      const dueDate = await deps.initializeCaseSla({
        organizationId,
        caseId,
        priority,
        now,
        tx,
      });

      // CASE-002: el enrutamiento importa mas por esta via que por la manual.
      // Un caso que entra por webhook no tiene a nadie delante para asignarlo,
      // asi que sin regla se queda en la bandeja general hasta que alguien mire.
      const tags = Array.isArray(raw.tags)
        ? (raw.tags.filter((t) => typeof t === 'string') as string[])
        : ['WEBHOOK_INTAKE', 'FINTURU'];

      const routed = deps.routeCase
        ? await deps.routeCase({
            organizationId,
            kase: {
              riskScore,
              priority,
              tags,
              customerEmail,
              stripeCustomerId,
              bridgeWallet,
            },
            tx,
          })
        : null;

      const kase = Case.create({
        id: caseId,
        organizationId,
        customerId,
        customerEmail,
        bridgeUserId,
        bridgeWallet,
        stripeCustomerId,
        finturuReference: typeof raw.reference === 'object' && raw.reference !== null ? (raw.reference as Record<string, unknown>) : null,
        finturuCacheSnapshot: raw,
        riskScore,
        priority,
        assignedTo: routed?.assignedTo ?? null,
        tags,
        now,
      }).withDueDate(dueDate, now);

      await deps.cases.save(kase, tx);

      // 2. Record Timeline Event (only if not explicitly disabled by bulk sync)
      if (input.recordTimeline !== false) {
        const timelineEvent = CaseTimelineEvent.create({
          id: deps.generateTimelineEventId(),
          caseId: kase.id,
          eventType: 'CASE_CREATED',
          previousValue: null,
          newValue: 'OPEN',
          createdBy: 'SYSTEM_WEBHOOK',
          createdAt: now,
        });
        await deps.timelineRecorder.record(timelineEvent, tx);

        if (routed?.assignedTo) {
          await deps.timelineRecorder.record(
            CaseTimelineEvent.create({
              id: deps.generateTimelineEventId(),
              caseId: kase.id,
              eventType: 'ROUTED',
              previousValue: routed.ruleName,
              newValue: `${routed.assignedTo.type}:${routed.assignedTo.id}`,
              createdBy: 'SYSTEM_WEBHOOK',
              createdAt: now,
            }),
            tx,
          );
        }
      }

      // 3. Record Audit Log
      await deps.auditRecorder.record(
        {
          organizationId,
          actorType: 'ORGANIZATION',
          actorId: 'webhook_finturu',
          action: 'CREATE_CASE',
          resource: 'case',
          resourceId: kase.id,
          detail: {
            source: 'WEBHOOK_FINTURU',
            customerId: kase.customerId,
            riskScore: kase.riskScore,
            priority: kase.priority,
            bridgeUserId: kase.bridgeUserId,
            bridgeWallet: kase.bridgeWallet,
            stripeCustomerId: kase.stripeCustomerId,
          },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      // 4. Record Outbox Event
      const outboxEventId = deps.generateTimelineEventId();
      const outboxEvent = OutboxEvent.create({
        id: outboxEventId,
        aggregateType: 'Case',
        aggregateId: kase.id,
        eventType: 'case.created',
        payload: {
          caseId: kase.id,
          organizationId: kase.organizationId,
          customerId: kase.customerId,
          customerEmail: kase.customerEmail,
          bridgeUserId: kase.bridgeUserId,
          bridgeWallet: kase.bridgeWallet,
          stripeCustomerId: kase.stripeCustomerId,
          riskScore: kase.riskScore,
          status: kase.status,
          priority: kase.priority,
          createdAt: kase.createdAt,
        },
        now,
      });
      await deps.outbox.record(outboxEvent, tx);

      return {
        case: kase,
        outboxEventId,
      };
    });
  };
}
