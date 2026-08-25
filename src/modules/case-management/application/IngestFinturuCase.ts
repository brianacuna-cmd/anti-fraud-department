import type { Clock } from '../../../shared/time/Clock.js';
import { ACTIVE_CASE_STATUSES } from '../domain/ports/CaseRepository.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { InitializeCaseSlaService } from './InitializeCaseSla.js';
import type { RouteCaseInput } from './RouteCase.js';
import type { OutboxEventRepository } from '../../../shared/outbox/OutboxEventRepository.js';
import type { OutboxEventId } from '../../../shared/outbox/OutboxEventId.js';
import type { CaseId } from '../domain/model/value-objects/CaseId.js';
import type { TimelineEventId } from '../domain/model/value-objects/TimelineEventId.js';
import { invariantViolation } from '../domain/errors/CaseManagementError.js';
import { Case } from '../domain/model/aggregates/Case.js';
import { CaseTimelineEvent } from '../domain/model/aggregates/CaseTimelineEvent.js';
import { OutboxEvent } from '../../../shared/outbox/OutboxEvent.js';
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
  readonly outbox: OutboxEventRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly generateCaseId: () => CaseId;
  readonly generateTimelineEventId: () => TimelineEventId;
  readonly auditRecorder: AuditRecorder;
  readonly generateOutboxEventId: () => OutboxEventId;
  readonly initializeCaseSla: InitializeCaseSlaService;
  /**
   * CASE-002. Es el caso de uso `RouteCase` compuesto (el mismo que recibe
   * `CreateCase`), asi que la asignacion, su hito `ASSIGNED` y su fila de
   * auditoria confirman dentro de ESTA transaccion. Opcional: sin el, el
   * expediente nace sin asignar y espera en la bandeja general.
   */
  readonly routeCase?: (input: RouteCaseInput) => Promise<Case>;
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

/** La forma que Mongo acepta como ObjectId: 24 caracteres hexadecimales. */
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * Resuelve el inquilino al que pertenece el expediente, o falla diciendo por que.
 *
 * Antes, cuando no se resolvia ninguno, se inventaba el literal `'finturu-org'`.
 * Desde la migracion a ObjectId nativo eso reventaba dentro del driver con un
 * `BSONError` sobre cadenas hexadecimales: el webhook devolvia un 400 cuyo
 * mensaje no decia nada del problema real, y el operador no tenia forma de
 * saber que lo que faltaba era la organizacion.
 *
 * Un identificador que no sea un ObjectId —tipicamente un slug, que la lista de
 * extraccion admite— se rechaza en lugar de caer al inquilino por defecto: el
 * payload designo un inquilino concreto, y archivar su caso de fraude bajo otro
 * seria una fuga entre inquilinos, mucho peor que un webhook rechazado.
 */
function requireTenantId(candidate: string | undefined): string {
  const value = candidate?.trim();

  if (!value) {
    throw invariantViolation(
      'Finturu ingestion resolved no organization: the payload carries none and no default was configured',
      { field: 'organizationId' },
    );
  }

  if (!OBJECT_ID_PATTERN.test(value)) {
    throw invariantViolation(
      `Finturu ingestion resolved organization "${value}", which is not a 24-character hexadecimal ObjectId`,
      { field: 'organizationId', value },
    );
  }

  return value;
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

    const organizationId = requireTenantId(explicitOrgId);

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

        const updateOutboxEventId = deps.generateOutboxEventId();
        await deps.outbox.save(
          OutboxEvent.create({
            id: updateOutboxEventId,
            organizationId,
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

      // El payload de Finturu puede traer etiquetas propias; si no, se marcan
      // el origen y el canal para que la bandeja sepa de donde vino.
      const tags = Array.isArray(raw.tags)
        ? (raw.tags.filter((t) => typeof t === 'string') as string[])
        : ['WEBHOOK_INTAKE', 'FINTURU'];

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
      }

      // CASE-002: el enrutamiento importa mas por esta via que por la manual —
      // un caso que entra por webhook no tiene a nadie delante para asignarlo.
      // `RouteCase` persiste la asignacion, emite su propio hito `ASSIGNED` y
      // audita la regla ganadora, todo dentro de esta misma transaccion.
      // `createdBy: null` porque la regla, y no un humano, eligio al
      // responsable.
      const routedCase = deps.routeCase
        ? await deps.routeCase({
            kase,
            tx,
            createdBy: null,
            actorType: 'ORGANIZATION',
            ipAddress: input.ipAddress ?? null,
          })
        : kase;

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

      // 4. Record Outbox Event — se emite sobre `routedCase`, no sobre `kase`,
      // para que el consumidor vea el expediente tal y como quedo confirmado
      // (con responsable si alguna regla lo asigno).
      const outboxEventId = deps.generateOutboxEventId();
      const outboxEvent = OutboxEvent.create({
        id: outboxEventId,
        organizationId: routedCase.organizationId,
        aggregateType: 'Case',
        aggregateId: routedCase.id,
        eventType: 'case.created',
        payload: {
          caseId: routedCase.id,
          organizationId: routedCase.organizationId,
          customerId: routedCase.customerId,
          customerEmail: routedCase.customerEmail,
          bridgeUserId: routedCase.bridgeUserId,
          bridgeWallet: routedCase.bridgeWallet,
          stripeCustomerId: routedCase.stripeCustomerId,
          riskScore: routedCase.riskScore,
          status: routedCase.status,
          priority: routedCase.priority,
          assignedTo: routedCase.assignedTo?.id ?? null,
          createdAt: routedCase.createdAt,
        },
        now,
      });
      await deps.outbox.save(outboxEvent, tx);

      return {
        case: routedCase,
        outboxEventId,
      };
    });
  };
}
