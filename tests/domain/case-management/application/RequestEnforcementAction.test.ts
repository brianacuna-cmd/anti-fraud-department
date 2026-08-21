import { oid } from '../../../support/oid.js';
import { createRequestEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RequestEnforcementAction.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { AnalystDecision } from '../../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { generateApprovalRequestId } from '../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryApprovalRequestRepository } from '../../../helpers/case-management/InMemoryApprovalRequestRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryCaseManagementNotificationSender } from '../../../helpers/case-management/InMemoryCaseManagementNotificationSender.js';
import { InMemoryAssigneeDirectory } from '../../../helpers/case-management/InMemoryAssigneeDirectory.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const CASE_ID = createCaseId(oid('case-1'));
const OTHER_CASE_ID = createCaseId(oid('case-2'));
const DECISION_ID = createAnalystDecisionId(oid('decision-1'));
const ANALYST_ID = oid('analyst-1');
const SUPERVISOR_ID = oid('supervisor-1');

const ANALYST = createAuthContext({
  userId: ANALYST_ID,
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ADMIN',
});

function buildCase(organizationId = ORG_1, id = CASE_ID): Case {
  return Case.create({
    id,
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(80),
    priority: 'HIGH',
    now: NOW,
  });
}

function buildDecision(overrides: { organizationId?: string; caseId?: typeof CASE_ID } = {}): AnalystDecision {
  return AnalystDecision.create({
    id: DECISION_ID,
    caseId: overrides.caseId ?? CASE_ID,
    organizationId: overrides.organizationId ?? ORG_1,
    decision: 'FRAUD_CONFIRMED',
    confidence: 90,
    comment: 'red confirmada',
    createdBy: ANALYST_ID,
    now: NOW,
  });
}

function setup() {
  const cases = new InMemoryCaseRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const approvalRequests = new InMemoryApprovalRequestRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const notificationSender = new InMemoryCaseManagementNotificationSender();
  const assigneeDirectory = new InMemoryAssigneeDirectory();

  const requestEnforcement = createRequestEnforcementActionUseCase({
    cases,
    decisions,
    enforcementActions,
    approvalRequests,
    timelineRecorder,
    notificationSender,
    assigneeDirectory,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateEnforcementActionId,
    generateApprovalRequestId,
    generateTimelineEventId,
  });

  return {
    cases,
    decisions,
    enforcementActions,
    approvalRequests,
    timelineRecorder,
    auditRecorder,
    notificationSender,
    assigneeDirectory,
    requestEnforcement,
  };
}

const VALID = {
  analystDecisionId: DECISION_ID,
  actionType: 'BLOCK',
  targetType: 'WALLET',
  targetId: '0xabc',
};

describe('RequestEnforcementAction (ENF-001)', () => {
  it('crea la sanción PENDING sobre un dictamen ya registrado', async () => {
    const { cases, decisions, enforcementActions, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());

    const result = await requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID });

    expect(result.enforcementAction.status).toBe('PENDING');
    expect(result.enforcementAction.actionType).toBe('BLOCK');
    expect(result.enforcementAction.analystDecisionId).toBe(DECISION_ID);
    expect(await enforcementActions.findById(result.enforcementAction.id)).not.toBeNull();
  });

  it('abre la solicitud de cuatro ojos y avisa a los supervisores', async () => {
    const { cases, decisions, assigneeDirectory, notificationSender, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());
    assigneeDirectory.allowRoleRecipients(ORG_1, 'SUPERVISOR', [SUPERVISOR_ID]);

    const result = await requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID });

    expect(result.approvalRequest).not.toBeNull();
    expect(result.approvalRequest!.status).toBe('PENDING');
    expect(notificationSender.all()).toHaveLength(1);
    expect(notificationSender.all()[0]!.recipientUserId).toBe(SUPERVISOR_ID);
    expect(notificationSender.all()[0]!.alertType).toBe('APROBACION_PENDIENTE');
  });

  it('no exige doble firma para REVIEW', async () => {
    const { cases, decisions, notificationSender, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());

    // Marcar a alguien para mirarlo con calma no restringe nada al cliente.
    const result = await requestEnforcement({
      auth: ANALYST,
      caseId: CASE_ID,
      ...VALID,
      actionType: 'REVIEW',
    });

    expect(result.approvalRequest).toBeNull();
    expect(notificationSender.all()).toHaveLength(0);
  });

  it('no avisa al propio solicitante aunque sea supervisor', async () => {
    const { cases, decisions, assigneeDirectory, notificationSender, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());
    assigneeDirectory.allowRoleRecipients(ORG_1, 'SUPERVISOR', [ANALYST_ID, SUPERVISOR_ID]);

    await requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID });

    // Los cuatro ojos le van a negar su propia revisión: avisarle sería
    // ofrecerle algo que no puede hacer.
    expect(notificationSender.all().map((n) => n.recipientUserId)).toEqual([SUPERVISOR_ID]);
  });

  it('registra el hito en la cronología', async () => {
    const { cases, decisions, timelineRecorder, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());

    await requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID });

    expect(timelineRecorder.all().map((e) => e.eventType)).toContain('ENFORCEMENT_REQUESTED');
  });

  it('audita la solicitud aparte del dictamen', async () => {
    const { cases, decisions, auditRecorder, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());

    await requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID });

    const entry = auditRecorder.all().find((e) => e.action === 'REQUEST_ENFORCEMENT_ACTION');
    expect(entry).toBeDefined();
    expect(entry!.resource).toBe('enforcement_action');
    expect(entry!.detail).toMatchObject({ analystDecisionId: DECISION_ID, actionType: 'BLOCK' });
  });

  it('rechaza al rol observador ADMIN', async () => {
    const { cases, decisions, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());

    // Segregación de funciones: quien concede permisos no sanciona.
    await expect(
      requestEnforcement({ auth: ADMIN, caseId: CASE_ID, ...VALID }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('404 cuando el expediente no existe', async () => {
    const { decisions, requestEnforcement } = setup();
    await decisions.save(buildDecision());

    await expect(
      requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID }),
    ).rejects.toThrow(/not found|caseNotFound/i);
  });

  it('rechaza un dictamen que no existe', async () => {
    const { cases, requestEnforcement } = setup();
    await cases.save(buildCase());

    // Sin veredicto registrado no hay sanción: es el invariante que sostiene
    // el expediente ante un regulador.
    await expect(
      requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID }),
    ).rejects.toThrow(CaseManagementError);
  });

  it('rechaza un dictamen que pertenece a otro expediente', async () => {
    const { cases, decisions, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision({ caseId: OTHER_CASE_ID }));

    await expect(
      requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID }),
    ).rejects.toThrow(/must reference a decision of this case/);
  });

  it('no cruza inquilinos', async () => {
    const { cases, decisions, requestEnforcement } = setup();
    await cases.save(buildCase(ORG_2));
    await decisions.save(buildDecision({ organizationId: ORG_2 }));

    await expect(
      requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID }),
    ).rejects.toThrow(/does not belong/);
  });

  it('rechaza un objetivo vacío', async () => {
    const { cases, decisions, requestEnforcement } = setup();
    await cases.save(buildCase());
    await decisions.save(buildDecision());

    await expect(
      requestEnforcement({ auth: ANALYST, caseId: CASE_ID, ...VALID, targetId: '   ' }),
    ).rejects.toThrow(CaseManagementError);
  });
});
