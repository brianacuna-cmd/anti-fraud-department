import { oid } from '../../../support/oid.js';
import { createOpenFraudCaseUseCase } from '../../../../src/modules/case-management/application/OpenFraudCaseFromCustomer.js';
import { createInitializeCaseSlaService } from '../../../../src/modules/case-management/application/InitializeCaseSla.js';
import { createRouteCaseUseCase } from '../../../../src/modules/case-management/application/RouteCase.js';
import type { RoutingEngine, RoutingEvaluation } from '../../../../src/modules/case-management/domain/ports/RoutingEngine.js';
import { CaseRoutingRule } from '../../../../src/modules/case-management/domain/model/aggregates/CaseRoutingRule.js';
import { generateCaseRoutingRuleId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseRoutingRuleId.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { generateCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateCaseSlaTrackingId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseSlaTrackingId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseSlaTrackingRepository } from '../../../helpers/case-management/InMemoryCaseSlaTrackingRepository.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { generateOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseRoutingRuleRepository } from '../../../helpers/case-management/InMemoryCaseRoutingRuleRepository.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';

class NoMatchRoutingEngine implements RoutingEngine {
  async evaluate(): Promise<RoutingEvaluation> {
    return { targetUserId: null, targetRoleId: null };
  }
}

class MatchingRoutingEngine implements RoutingEngine {
  constructor(private readonly targetUserId: string) {}
  async evaluate(): Promise<RoutingEvaluation> {
    return { targetUserId: this.targetUserId, targetRoleId: null };
  }
}

const NOW = fromDate(new Date('2026-08-20T10:00:00.000Z'));
const ORG = oid('org-1');
const ORG_2 = oid('org-2');

const ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: ORG,
  actorType: 'USER',
  roleId: 'ADMIN',
});
// El dueño del tenant: no toda organización tiene un usuario ADMIN creado.
const ORG_ACTOR = createAuthContext({
  userId: ORG,
  organizationId: ORG,
  actorType: 'ORGANIZATION',
});
const SUPERVISOR = createAuthContext({
  userId: oid('sup-1'),
  organizationId: ORG,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ANALYST = createAuthContext({
  userId: oid('an-1'),
  organizationId: ORG,
  actorType: 'USER',
  roleId: 'ANALYST',
});

/**
 * By default seeds ONE active (but never-matching) routing rule, so tests
 * that don't care about auto-routing keep exercising the same "stays
 * unassigned" path as before `NO_ACTIVE_ROUTING_RULE` existed — the guard
 * only fires when the org has ZERO active rules. Pass `seedActiveRule:
 * false` to test that guard, or a `routingEngine` to test an actual match.
 */
function build(
  options: { seedActiveRule?: boolean; seedFraudConfig?: boolean; routingEngine?: RoutingEngine } = {},
) {
  const cases = new InMemoryCaseRepository();
  const outbox = new InMemoryOutboxEventRepository();
  const slaTracking = new InMemoryCaseSlaTrackingRepository();
  const assigneeDirectory = new InMemoryAssigneeDirectory();
  const routingRules = new InMemoryCaseRoutingRuleRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const clock = new FixedClock(NOW);
  /*
   * Sembrada: abrir a mano exige que el inquilino tenga configuración
   * antifraude. Sin ella el caso nacería con un plazo que nadie acordó.
   */
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  if (options.seedFraudConfig !== false) {
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

  if (options.seedActiveRule !== false) {
    void routingRules.save(
      CaseRoutingRule.create({
        id: generateCaseRoutingRuleId(),
        organizationId: ORG,
        name: 'test-rule',
        conditions: {},
        conditionsVersion: 1,
        now: NOW,
      }).activate(NOW),
    );
  }

  const routeCase = createRouteCaseUseCase({
    cases,
    routingRules,
    routingEngine: options.routingEngine ?? new NoMatchRoutingEngine(),
    timelineRecorder,
    auditRecorder,
    fraudConfig: new InMemoryOrganizationFraudConfigRepository(),
    assigneeDirectory,
    clock,
    generateTimelineEventId,
  });

  const openFraudCase = createOpenFraudCaseUseCase({
    cases,
    timelineRecorder,
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock,
    generateCaseId,
    generateTimelineEventId,
    generateOutboxEventId,
    auditRecorder,
    fraudConfig,
    initializeCaseSla: createInitializeCaseSlaService({
      slaTracking,
      fraudConfig,
      generateCaseSlaTrackingId,
    }),
    assigneeDirectory,
    routingRules,
    routeCase,
  });

  return { openFraudCase, cases, assigneeDirectory, routingRules, fraudConfig };
}

describe('createOpenFraudCaseUseCase — asignación manual al crear', () => {
  it('permite auto-asignarse a uno mismo sin importar el rol', async () => {
    const { openFraudCase, cases } = build();

    const result = await openFraudCase({
      auth: ANALYST,
      customerId: 'customer-1',
      autoAssignToMe: true,
      rawSnapshot: {},
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('an-1') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('an-1') });
  });

  it('ADMIN puede asignar el caso a otro usuario ACTIVE de la misma organización', async () => {
    const { openFraudCase, cases, assigneeDirectory } = build();
    const target = createAssignedTo('USER', oid('an-2'));
    assigneeDirectory.allow(ORG, target);

    const result = await openFraudCase({
      auth: ADMIN,
      customerId: 'customer-1',
      assignedTo: { type: 'USER', id: oid('an-2') },
      rawSnapshot: {},
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
  });

  it('rechaza a un SUPERVISOR que intenta asignar el caso a otro usuario (FORBIDDEN_ROLE)', async () => {
    const { openFraudCase, assigneeDirectory, cases } = build();
    const target = createAssignedTo('USER', oid('an-2'));
    assigneeDirectory.allow(ORG, target);

    await expect(
      openFraudCase({
        auth: SUPERVISOR,
        customerId: 'customer-1',
        assignedTo: { type: 'USER', id: oid('an-2') },
        rawSnapshot: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect(cases.all()).toHaveLength(0);
  });

  it('rechaza a un ANALYST que intenta asignar el caso a otro usuario (FORBIDDEN_ROLE)', async () => {
    const { openFraudCase, assigneeDirectory, cases } = build();
    const target = createAssignedTo('USER', oid('an-2'));
    assigneeDirectory.allow(ORG, target);

    await expect(
      openFraudCase({
        auth: ANALYST,
        customerId: 'customer-1',
        assignedTo: { type: 'USER', id: oid('an-2') },
        rawSnapshot: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect(cases.all()).toHaveLength(0);
  });

  it('rechaza a ADMIN asignando a un usuario que no pertenece a la organización (FORBIDDEN_CROSS_TENANT)', async () => {
    const { openFraudCase, assigneeDirectory, cases } = build();
    const target = createAssignedTo('USER', oid('foreign-user'));
    assigneeDirectory.allow(ORG_2, target);

    await expect(
      openFraudCase({
        auth: ADMIN,
        customerId: 'customer-1',
        assignedTo: { type: 'USER', id: oid('foreign-user') },
        rawSnapshot: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
    expect(cases.all()).toHaveLength(0);
  });

  it('rechaza a ADMIN asignando a un usuario inactivo/no reconocido por el directorio (FORBIDDEN_CROSS_TENANT)', async () => {
    const { openFraudCase, cases } = build();

    await expect(
      openFraudCase({
        auth: ADMIN,
        customerId: 'customer-1',
        assignedTo: { type: 'USER', id: oid('inactive-user') },
        rawSnapshot: {},
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
    expect(cases.all()).toHaveLength(0);
  });

  it('ADMIN asignándose a sí mismo no requiere pasar por el directorio', async () => {
    const { openFraudCase, cases } = build();

    const result = await openFraudCase({
      auth: ADMIN,
      customerId: 'customer-1',
      assignedTo: { type: 'USER', id: oid('admin-1') },
      rawSnapshot: {},
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('admin-1') });
  });

  it('la ORGANIZACIÓN puede asignar el caso a un usuario ACTIVE sin necesidad de un ADMIN', async () => {
    const { openFraudCase, cases, assigneeDirectory } = build();
    const target = createAssignedTo('USER', oid('sup-1'));
    assigneeDirectory.allow(ORG, target);

    const result = await openFraudCase({
      auth: ORG_ACTOR,
      customerId: 'customer-1',
      assignedTo: { type: 'USER', id: oid('sup-1') },
      rawSnapshot: {},
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('sup-1') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('sup-1') });
  });

  it('sin assignedTo ni autoAssignToMe, el caso queda sin asignar (pero hay una regla activa que no matchea)', async () => {
    const { openFraudCase, cases } = build();

    const result = await openFraudCase({
      auth: ANALYST,
      customerId: 'customer-1',
      rawSnapshot: {},
    });

    expect(result.assignedTo).toBeNull();
    expect(cases.all()[0]?.assignedTo).toBeNull();
  });
});

describe('createOpenFraudCaseUseCase — auto-routing (CASE-002) cuando nadie eligió asignatario', () => {
  it('lanza NO_ACTIVE_ROUTING_RULE si nadie elige asignatario y la organización no tiene ninguna regla activa', async () => {
    const { openFraudCase, cases } = build({ seedActiveRule: false });

    await expect(
      openFraudCase({ auth: ANALYST, customerId: 'customer-1', rawSnapshot: {} }),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_ROUTING_RULE' });
    expect(cases.all()).toHaveLength(0);
  });

  it('auto-asigna el caso vía la regla de enrutamiento activa cuando nadie eligió a mano', async () => {
    const { openFraudCase, cases, assigneeDirectory } = build({
      routingEngine: new MatchingRoutingEngine(oid('an-2')),
    });
    assigneeDirectory.allow(ORG, createAssignedTo('USER', oid('an-2')));

    const result = await openFraudCase({ auth: ANALYST, customerId: 'customer-1', rawSnapshot: {} });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
  });

  it('al reabrir un caso nunca asignado, también le da una oportunidad al enrutamiento automático', async () => {
    const { openFraudCase, cases, assigneeDirectory } = build({
      routingEngine: new MatchingRoutingEngine(oid('an-2')),
    });
    assigneeDirectory.allow(ORG, createAssignedTo('USER', oid('an-2')));

    await openFraudCase({ auth: ANALYST, customerId: 'customer-1', rawSnapshot: {} });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });

    // Reabrir el mismo cliente (mismo customerId) sin elegir asignatario:
    // el caso ya tiene dueño, así que no debería volver a tocarlo ni fallar
    // por falta de regla.
    const reopened = await openFraudCase({ auth: ANALYST, customerId: 'customer-1', rawSnapshot: {} });
    expect(reopened.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
  });

  it('no bloquea la asignación manual explícita aunque no exista ninguna regla activa', async () => {
    const { openFraudCase, cases, assigneeDirectory } = build({ seedActiveRule: false });
    const target = createAssignedTo('USER', oid('an-2'));
    assigneeDirectory.allow(ORG, target);

    const result = await openFraudCase({
      auth: ADMIN,
      customerId: 'customer-1',
      assignedTo: { type: 'USER', id: oid('an-2') },
      rawSnapshot: {},
    });

    expect(result.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
    expect(cases.all()[0]?.assignedTo).toEqual({ type: 'USER', id: oid('an-2') });
  });
});

/**
 * Añadidos del fork: el departamento tiene que estar configurado, y el
 * expediente solo puede recaer en quien lo instruye.
 */
describe('createOpenFraudCaseUseCase — requisitos de apertura del fork', () => {
  const AUDITOR_ID = oid('auditor-1');

  it('rechaza abrir el caso si la organización no tiene configuración antifraude', async () => {
    const { openFraudCase, cases } = build({ seedFraudConfig: false });

    await expect(
      openFraudCase({ auth: ANALYST, customerId: 'customer-1', autoAssignToMe: true, rawSnapshot: {} }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_FRAUD_CONFIG_NOT_FOUND' });

    /* Se comprueba antes de escribir: no queda un expediente a medias. */
    expect(cases.all()).toHaveLength(0);
  });

  /*
   * ADMIN administra personas y AUDITOR fiscaliza: ninguno instruye. Un
   * expediente en su bandeja no lo trabaja nadie y rompe la segregación de
   * funciones sobre la que se apoya el resto de la política de acceso.
   */
  it('rechaza a un asignatario del plano de gobierno', async () => {
    const { openFraudCase, assigneeDirectory, cases } = build();
    assigneeDirectory.allow(ORG, { type: 'USER', id: AUDITOR_ID });
    assigneeDirectory.denyCaseWork(ORG, { type: 'USER', id: AUDITOR_ID });

    await expect(
      openFraudCase({
        auth: ADMIN,
        customerId: 'customer-1',
        assignedTo: { type: 'USER', id: AUDITOR_ID },
        rawSnapshot: {},
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_CANNOT_WORK_CASES' });

    expect(cases.all()).toHaveLength(0);
  });

  /* Cubre también «asignármelo a mí»: un ADMIN no puede quedarse el caso. */
  it('rechaza la autoasignación de quien no instruye', async () => {
    const { openFraudCase, assigneeDirectory } = build();
    assigneeDirectory.denyCaseWork(ORG, { type: 'USER', id: oid('admin-1') });

    await expect(
      openFraudCase({ auth: ADMIN, customerId: 'customer-1', autoAssignToMe: true, rawSnapshot: {} }),
    ).rejects.toMatchObject({ code: 'ASSIGNEE_CANNOT_WORK_CASES' });
  });
});
