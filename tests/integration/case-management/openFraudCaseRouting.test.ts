import { oid } from '../../support/oid.js';
import { InMemoryAssigneeDirectory } from '../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { createOpenFraudCaseUseCase } from '../../../src/modules/case-management/application/OpenFraudCaseFromCustomer.js';
import { createRouteCaseUseCase } from '../../../src/modules/case-management/application/RouteCase.js';
import { createInitializeCaseSlaService } from '../../../src/modules/case-management/application/InitializeCaseSla.js';
import { CaseRoutingRule } from '../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { generateCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { ZenRoutingEngine } from '../../../src/modules/case-management/infrastructure/adapters/outbound/zen/ZenRoutingEngine.js';
import { buildPriorityRoutingJdm } from '../../../src/modules/case-management/domain/services/priorityRoutingJdm.js';
import { PassthroughUnitOfWork } from '../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { InMemoryCaseRepository } from '../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryCaseRoutingRuleRepository } from '../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryTimelineRecorder } from '../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryCaseSlaTrackingRepository } from '../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { generateOutboxEventId } from '../../../src/shared/outbox/OutboxEventId.js';
import { createAuthContext } from '../../../src/shared/kernel/AuthContext.js';
import { OrganizationFraudConfig } from '../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { CaseManagementError } from '../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG = oid('org-1');
const ANALYST = oid('user-analyst');
const ON_CALL = oid('user-on-call');

/**
 * Abrir un caso a mano SIN elegir responsable tiene que caer en las reglas de
 * enrutamiento.
 *
 * Esta vía nació sin `RouteCase` y el síntoma era mudo: mientras la casilla
 * «asignármelo a mí» venía marcada, el caso salía asignado y parecía que todo
 * funcionaba. Al desmarcarla, el expediente nacía huérfano y las reglas no se
 * aplicaban nunca por aquí — solo por `POST /cases` y por la ingesta.
 */
/** La configuración antifraude del inquilino: sin ella no se abre nada a mano. */
function seedFraudConfig(fraudConfig: InMemoryOrganizationFraudConfigRepository): void {
  fraudConfig.seed(
    OrganizationFraudConfig.create({
      id: generateOrganizationFraudConfigId(),
      organizationId: ORG,
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      featureFlags: {},
      now: NOW,
    }),
  );
}

function buildOpenFraudCase({ withFraudConfig = true } = {}) {
  const cases = new InMemoryCaseRepository();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  /* Permisiva salvo para quien se marque como gobierno con `denyCaseWork`. */
  const assigneeDirectory = new InMemoryAssigneeDirectory();
  const clock = { now: () => NOW };

  const openFraudCase = createOpenFraudCaseUseCase({
    cases,
    timelineRecorder,
    outbox: new InMemoryOutboxEventRepository(),
    unitOfWork: new PassthroughUnitOfWork(),
    clock,
    generateCaseId,
    generateTimelineEventId,
    generateOutboxEventId,
    auditRecorder,
    fraudConfig,
    assigneeDirectory,
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking,
      fraudConfig,
      generateCaseSlaTrackingId,
    }),
    /* El motor de verdad: con un doble, esta prueba no diría nada. */
    routeCase: createRouteCaseUseCase({
      cases,
      routingRules,
      routingEngine: new ZenRoutingEngine(),
      timelineRecorder,
      auditRecorder,
      fraudConfig,
      assigneeDirectory,
      clock,
      generateTimelineEventId,
    }),
  });

  if (withFraudConfig) {
    seedFraudConfig(fraudConfig);
  }

  return { openFraudCase, cases, routingRules, timelineRecorder, auditRecorder, assigneeDirectory };
}

/** Regla activa: los casos de prioridad ALTA van al analista de guardia. */
function seedHighPriorityRule(routingRules: InMemoryCaseRoutingRuleRepository): void {
  routingRules.add(
    CaseRoutingRule.create({
      id: generateCaseRoutingRuleId(),
      organizationId: ORG,
      name: 'Alta -> guardia',
      conditions: buildPriorityRoutingJdm([
        { priority: 'HIGH', targetType: 'USER', targetId: ON_CALL },
      ]),
      conditionsVersion: 1,
      status: 'ACTIVE',
      now: NOW,
    }),
  );
}

const AUTH = createAuthContext({ userId: ANALYST, organizationId: ORG, roleId: 'ANALYST' });

const BASE_INPUT = {
  auth: AUTH,
  customerId: 'customer-1',
  priority: 'HIGH',
  rawSnapshot: {},
};

/** Permisiva: estas pruebas comprueban otra cosa. */
const assigneeDirectory = new InMemoryAssigneeDirectory();

describe('openFraudCase auto-routing', () => {
  it('applies the routing rule when nobody was chosen', async () => {
    const { openFraudCase, routingRules, timelineRecorder } = buildOpenFraudCase();
    seedHighPriorityRule(routingRules);

    const kase = await openFraudCase({ ...BASE_INPUT, autoAssignToMe: false });

    expect(kase.assignedTo).toEqual({ type: 'USER', id: ON_CALL });
    expect(timelineRecorder.all().map((e) => e.eventType)).toContain('ASSIGNED');
  });

  /*
   * Quien abre el expediente y decide a quién le toca no puede ver cómo una
   * regla se lo quita: la elección explícita gana siempre.
   */
  it('does not let the rule override an explicit assignee', async () => {
    const { openFraudCase, routingRules } = buildOpenFraudCase();
    seedHighPriorityRule(routingRules);

    const kase = await openFraudCase({
      ...BASE_INPUT,
      assignedTo: { type: 'USER', id: ANALYST },
    });

    expect(kase.assignedTo).toEqual({ type: 'USER', id: ANALYST });
  });

  it('does not let the rule override "assign it to me"', async () => {
    const { openFraudCase, routingRules } = buildOpenFraudCase();
    seedHighPriorityRule(routingRules);

    const kase = await openFraudCase({ ...BASE_INPUT, autoAssignToMe: true });

    expect(kase.assignedTo).toEqual({ type: 'USER', id: ANALYST });
  });

  /* Un expediente que vuelve a la bandeja sin dueño tiene el mismo problema. */
  it('routes a reopened case that would come back unassigned', async () => {
    const { openFraudCase, routingRules } = buildOpenFraudCase();
    seedHighPriorityRule(routingRules);

    const first = await openFraudCase({ ...BASE_INPUT, assignedTo: { type: 'USER', id: ANALYST } });
    expect(first.assignedTo).toEqual({ type: 'USER', id: ANALYST });

    const reopened = await openFraudCase({ ...BASE_INPUT, autoAssignToMe: false });

    expect(reopened.id).toBe(first.id);
    /* Ya tenía dueño: la regla no se lo quita. */
    expect(reopened.assignedTo).toEqual({ type: 'USER', id: ANALYST });
  });
});

/**
 * Abrir a mano exige que el departamento esté configurado.
 *
 * Por esta vía hay una persona delante que puede ir a arreglarlo, así que se
 * prefiere negar la apertura a crear un expediente que nadie va a mirar. Las
 * vías automáticas NO comparten esta política a propósito: rechazar un webhook
 * pierde el evento y allí no hay nadie a quien avisar.
 */
describe('openFraudCase intake requirements', () => {
  it('refuses to open a case when the organization has no fraud config', async () => {
    const { openFraudCase, routingRules, cases } = buildOpenFraudCase({ withFraudConfig: false });
    seedHighPriorityRule(routingRules);

    await expect(
      openFraudCase({ ...BASE_INPUT, assignedTo: { type: 'USER', id: ANALYST } }),
    ).rejects.toMatchObject({ code: 'CASE_INTAKE_NOT_CONFIGURED' });

    /* Se comprueba ANTES de escribir: no queda un expediente a medias. */
    expect(cases.all()).toHaveLength(0);
  });

  it('refuses to open a case that would end up with nobody', async () => {
    const { openFraudCase } = buildOpenFraudCase();

    await expect(openFraudCase({ ...BASE_INPUT, autoAssignToMe: false })).rejects.toThrow(
      CaseManagementError,
    );
  });

  /*
   * Una regla activa que no casa con este caso vale lo mismo que no tener
   * ninguna: por eso la comprobación es «acabó asignado», y no «existe una
   * regla».
   */
  it('refuses when the only active rule does not match this case', async () => {
    const { openFraudCase, routingRules } = buildOpenFraudCase();
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: ORG,
        name: 'Solo críticas',
        conditions: buildPriorityRoutingJdm([
          { priority: 'CRITICAL', targetType: 'USER', targetId: ON_CALL },
        ]),
        conditionsVersion: 1,
        status: 'INACTIVE',
        now: NOW,
      }),
    );

    await expect(
      openFraudCase({ ...BASE_INPUT, priority: 'HIGH', autoAssignToMe: false }),
    ).rejects.toMatchObject({ code: 'CASE_INTAKE_NOT_CONFIGURED' });
  });

  it('refuses when the matching rule is only a draft', async () => {
    const { openFraudCase, routingRules } = buildOpenFraudCase();
    routingRules.add(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: ORG,
        name: 'Borrador',
        conditions: buildPriorityRoutingJdm([
          { priority: 'HIGH', targetType: 'USER', targetId: ON_CALL },
        ]),
        conditionsVersion: 1,
        status: 'INACTIVE',
        now: NOW,
      }),
    );

    await expect(
      openFraudCase({ ...BASE_INPUT, autoAssignToMe: false }),
    ).rejects.toMatchObject({ code: 'CASE_INTAKE_NOT_CONFIGURED' });
  });

  /* Elegir a alguien a mano basta: no hace falta regla ninguna. */
  it('opens with an explicit assignee even with no routing rule at all', async () => {
    const { openFraudCase } = buildOpenFraudCase();

    const kase = await openFraudCase({
      ...BASE_INPUT,
      assignedTo: { type: 'ROLE', id: 'SUPERVISOR' },
    });

    expect(kase.assignedTo).toEqual({ type: 'ROLE', id: 'SUPERVISOR' });
  });
});

/**
 * El expediente no puede caer en manos de quien no lo instruye.
 *
 * ADMIN administra personas y AUDITOR fiscaliza: un caso en su bandeja no lo
 * trabaja nadie y rompe la segregación de funciones. La comprobación vive en
 * el directorio de asignatarios, no en la interfaz, porque la API acepta
 * cualquier id de usuario aunque el desplegable solo ofrezca a los operativos.
 */
describe('openFraudCase assignee must be able to work cases', () => {
  const AUDITOR = oid('user-auditor');

  it('refuses an explicit assignee from the governance plane', async () => {
    const { openFraudCase, assigneeDirectory, cases } = buildOpenFraudCase();
    assigneeDirectory.denyCaseWork(ORG, { type: 'USER', id: AUDITOR });

    await expect(
      openFraudCase({ ...BASE_INPUT, assignedTo: { type: 'USER', id: AUDITOR } }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_CANNOT_WORK_CASES' });

    /* Se comprueba antes de escribir: no queda un expediente a medias. */
    expect(cases.all()).toHaveLength(0);
  });

  it('refuses a ROLE queue from the governance plane', async () => {
    const { openFraudCase, assigneeDirectory } = buildOpenFraudCase();
    assigneeDirectory.denyCaseWork(ORG, { type: 'ROLE', id: 'AUDITOR' });

    await expect(
      openFraudCase({ ...BASE_INPUT, assignedTo: { type: 'ROLE', id: 'AUDITOR' } }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_CANNOT_WORK_CASES' });
  });

  /*
   * Una regla que reparte a gobierno se SALTA, no se aplica: puede haberse
   * escrito hace meses, o la persona haber pasado a ADMIN después. Al no
   * quedar nadie, la apertura se rechaza por la otra puerta.
   */
  it('skips a routing rule whose target cannot work cases', async () => {
    const { openFraudCase, routingRules, assigneeDirectory, auditRecorder } = buildOpenFraudCase();
    seedHighPriorityRule(routingRules);
    assigneeDirectory.denyCaseWork(ORG, { type: 'USER', id: ON_CALL });

    await expect(
      openFraudCase({ ...BASE_INPUT, autoAssignToMe: false }),
    ).rejects.toMatchObject({ code: 'CASE_INTAKE_NOT_CONFIGURED' });

    expect(auditRecorder.all().map((e) => e.action)).toContain('ROUTING_RULE_EVALUATION_FAILED');
  });
});
