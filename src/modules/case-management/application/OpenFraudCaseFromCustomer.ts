import type { AuthContext } from '../../../shared/kernel/AuthContext.js';
import type { Clock } from '../../../shared/time/Clock.js';
import type { CaseRepository } from '../domain/ports/CaseRepository.js';
import type { TimelineRecorder } from '../domain/ports/TimelineRecorder.js';
import type { UnitOfWork } from '../domain/ports/UnitOfWork.js';
import type { AuditRecorder } from '../domain/ports/AuditRecorder.js';
import type { OrganizationFraudConfigRepository } from '../domain/ports/OrganizationFraudConfigRepository.js';
import type { AssigneeDirectory } from '../domain/ports/AssigneeDirectory.js';
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
import {
  assigneeCannotWorkCases,
  caseIntakeNotConfigured,
} from '../domain/errors/CaseManagementError.js';
import type { RouteCaseInput } from './RouteCase.js';

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
  /**
   * Se lee para EXIGIRLA, no para calcular: `initializeCaseSla` sabe caer a
   * los valores de la casa cuando falta, y esa caída es correcta para las
   * vías automáticas. Por esta no: aquí hay alguien delante que puede ir a
   * configurarlo.
   */
  readonly fraudConfig: OrganizationFraudConfigRepository;
  /** Para comprobar que quien recibe el expediente lo puede instruir. */
  readonly assigneeDirectory: AssigneeDirectory;
  readonly initializeCaseSla: InitializeCaseSlaService;
  /**
   * Enrutamiento automático (CASE-002) para cuando nadie eligió responsable.
   *
   * Obligatoria y no opcional a propósito: esta vía nació sin ella y el
   * síntoma fue mudo — quien abría un caso sin marcar «asignármelo» lo dejaba
   * huérfano, y las reglas de enrutamiento no se aplicaban nunca por aquí. Una
   * dependencia opcional deja que eso vuelva a pasar sin que nadie se entere;
   * exigirla hace que el compilador lo impida.
   */
  readonly routeCase: (input: RouteCaseInput) => Promise<Case>;
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
      // Solo un actor USER tiene un "yo" al que asignarse. Para ORGANIZATION,
      // `auth.userId` lleva el id de la organización (el resolver lo rellena
      // así porque el campo no admite null), y asignarlo como si fuera un
      // usuario dejaba el caso apuntando a alguien que no existe.
      assignedTo = createAssignedTo('USER', input.auth.userId);
    }

    return deps.unitOfWork.withTransaction(async (tx) => {
      /*
       * Primero de todo, antes de escribir: un expediente cuyo SLA se calcula
       * con valores que el inquilino nunca eligió nace con un plazo que nadie
       * ha acordado, y ese plazo es el que luego se incumple.
       */
      const config = await deps.fraudConfig.findByOrganization(organizationId, tx);
      if (!config) {
        throw caseIntakeNotConfigured('MISSING_FRAUD_CONFIG', organizationId);
      }

      /*
       * También antes de escribir: una elección explícita que recae en
       * gobierno (o un ADMIN marcando «asignármelo a mí») se rechaza aquí, y
       * no se cae calladamente a las reglas — quien eligió mal tiene que
       * enterarse.
       */
      if (assignedTo !== null && !(await deps.assigneeDirectory.canWorkCases(organizationId, assignedTo))) {
        throw assigneeCannotWorkCases(assignedTo.type, assignedTo.id);
      }

      // Check if a case already exists
      // Sin `statuses`: a diferencia de la ingesta por webhook, abrir un caso a
      // mano sobre un cliente con expediente cerrado debe reabrir aquel, no
      // crear uno paralelo. Ese es el camino que ejercita `CASE_REOPENED` abajo.
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

        // CASE-009: reabrir reinicia el reloj. Sin esto un expediente que vuelve
        // a la bandeja arrastraría el `dueDate` del ciclo anterior —
        // normalmente ya vencido— y nacería incumpliendo su propio SLA.
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

        // Un expediente que vuelve a la bandeja sin dueño tiene el mismo
        // problema que uno nuevo sin dueño: nadie sabe que es suyo.
        return requireAssignee(await maybeRoute(deps, updated, input, tx), organizationId);
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

      // CASE-002: si nadie eligió responsable, deciden las reglas. `RouteCase`
      // persiste la asignación, emite su propio hito `ASSIGNED` y audita la
      // regla ganadora, todo dentro de esta misma transacción.
      const routed = requireAssignee(await maybeRoute(deps, kase, input, tx), organizationId);

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

      return routed;
    });
  };
}

/**
 * Aplica las reglas de enrutamiento SOLO si el caso quedó sin responsable.
 *
 * Una elección explícita —de la casilla «asignármelo» o del selector de
 * ADMIN— gana siempre sobre la regla: quien abre el expediente y decide a
 * quién le toca no puede ver cómo una regla se lo quita.
 *
 * `createdBy: null` porque en ese caso eligió la regla y no un humano, igual
 * que en `CreateCase` y en la ingesta por webhook. Que ninguna regla case
 * deja el caso sin asignar, que es el mismo desenlace que por las otras vías.
 */
async function maybeRoute(
  deps: OpenFraudCaseDeps,
  kase: Case,
  input: OpenFraudCaseInput,
  tx: Parameters<typeof deps.routeCase>[0]['tx'],
): Promise<Case> {
  if (kase.assignedTo !== null) {
    return kase;
  }
  return deps.routeCase({
    kase,
    tx,
    createdBy: null,
    actorType: input.auth.actorType,
    ipAddress: input.auth.ipAddress,
  });
}

/**
 * Un expediente abierto a mano tiene que salir con alguien que responda por él.
 *
 * Ni la elección explícita, ni «asignármelo», ni ninguna regla activa dieron
 * responsable: crear el caso igual lo dejaría fuera de toda bandeja, con su
 * reloj de SLA corriendo, hasta que alguien lo encontrara vencido. Se lanza
 * DESPUÉS de enrutar porque hasta entonces no se sabe: una regla activa que no
 * casa con este caso vale lo mismo que no tener ninguna.
 *
 * Lanzar aquí deshace la transacción entera —el caso, su hito y su fila de
 * SLA—, así que no queda a medias.
 */
function requireAssignee(kase: Case, organizationId: string): Case {
  if (kase.assignedTo === null) {
    throw caseIntakeNotConfigured('NO_ASSIGNEE', organizationId);
  }
  return kase;
}
