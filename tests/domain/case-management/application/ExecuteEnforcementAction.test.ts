import { oid } from '../../../support/oid.js';
import { createExecuteEnforcementActionUseCase } from '../../../../src/modules/case-management/application/ExecuteEnforcementAction.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { OrganizationFraudConfig } from '../../../../src/modules/case-management/domain/model/aggregates/OrganizationFraudConfig.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import {
  createEnforcementActionId,
  generateEnforcementActionId,
} from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createEnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createCasePriority } from '../../../../src/modules/case-management/domain/model/value-objects/CasePriority.js';
import { createOrganizationFraudConfigId } from '../../../../src/modules/case-management/domain/model/value-objects/OrganizationFraudConfigId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryOrganizationFraudConfigRepository } from '../../../helpers/case-management/InMemoryOrganizationFraudConfigRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import type { EnforcementActionType } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionType.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ACTION_ID = createEnforcementActionId(oid('action-execute-1'));
const CASE_ID = createCaseId(oid('case-execute-1'));
const CUSTOMER_ID = 'customer-1';
const WEBHOOK_URL = 'https://hooks.example/fraud';

const SUPERVISOR = createAuthContext({
  userId: oid('supervisor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'SUPERVISOR',
});
const ADMIN = createAuthContext({
  userId: oid('admin-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ADMIN',
});
const ANALYST = createAuthContext({
  userId: oid('analyst-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'ANALYST',
});
const AUDITOR = createAuthContext({
  userId: oid('auditor-1'),
  organizationId: ORG_1,
  actorType: 'USER',
  roleId: 'AUDITOR',
});

function buildCase(overrides: Partial<Parameters<typeof Case.create>[0]> = {}): Case {
  return Case.create({
    id: CASE_ID,
    organizationId: ORG_1,
    customerId: CUSTOMER_ID,
    riskScore: createRiskScore(80),
    priority: createCasePriority('HIGH'),
    now: NOW,
    ...overrides,
  });
}

function buildPendingAction(
  overrides: Partial<Parameters<typeof EnforcementAction.create>[0]> = {},
): EnforcementAction {
  return EnforcementAction.create({
    id: ACTION_ID,
    caseId: CASE_ID,
    organizationId: ORG_1,
    analystDecisionId: createAnalystDecisionId(oid('decision-execute-1')),
    actionType: createEnforcementActionType('BLOCK'),
    targetType: 'CUSTOMER',
    targetId: CUSTOMER_ID,
    createdBy: oid('analyst-1'),
    now: NOW,
    ...overrides,
  });
}

function buildApprovedAction(
  overrides: Partial<Parameters<typeof EnforcementAction.create>[0]> = {},
): EnforcementAction {
  return buildPendingAction(overrides).approve(NOW);
}

function seedFraudConfig(
  repo: InMemoryOrganizationFraudConfigRepository,
  outboundWebhookUrl: string | null,
): void {
  repo.seed(
    OrganizationFraudConfig.create({
      id: createOrganizationFraudConfigId(oid('config-execute-1')),
      organizationId: ORG_1,
      slaLowMinutes: 240,
      slaMediumMinutes: 120,
      slaHighMinutes: 60,
      slaCriticalMinutes: 30,
      riskThresholdLow: 25,
      riskThresholdMedium: 50,
      riskThresholdHigh: 75,
      riskThresholdCritical: 90,
      featureFlags: {},
      outboundWebhookUrl,
      now: NOW,
    }),
  );
}

function buildUseCase(options?: {
  seedAction?: EnforcementAction;
  seedCase?: Case;
  webhookUrl?: string | null;
  skipFraudConfig?: boolean;
}) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const cases = new InMemoryCaseRepository();
  const fraudConfig = new InMemoryOrganizationFraudConfigRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const outbox = new InMemoryOutboxEventRepository();

  if (options?.seedAction !== undefined) {
    void enforcementActions.save(options.seedAction);
  }
  const kase = options?.seedCase ?? buildCase();
  void cases.save(kase);
  if (options?.skipFraudConfig !== true) {
    seedFraudConfig(fraudConfig, options?.webhookUrl === undefined ? WEBHOOK_URL : options.webhookUrl);
  }

  const executeEnforcementAction = createExecuteEnforcementActionUseCase({
    enforcementActions,
    outgoingEvents,
    cases,
    fraudConfig,
    auditRecorder,
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateCustomerOutgoingEventId,
    generateOutboxEventId,
  });

  return {
    executeEnforcementAction,
    enforcementActions,
    outgoingEvents,
    cases,
    auditRecorder,
    outbox,
    caseStatusBefore: kase.status,
  };
}

describe('createExecuteEnforcementActionUseCase', () => {
  it('executes APPROVED action to EXECUTED and inserts outbox PENDING with exact 6-field payload', async () => {
    const { executeEnforcementAction, enforcementActions, outgoingEvents, auditRecorder, cases, caseStatusBefore } =
      buildUseCase({ seedAction: buildApprovedAction({ actionType: 'RESTRICT' }) });

    const result = await executeEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: ACTION_ID,
    });

    expect(result.enforcementAction.status).toBe('EXECUTED');
    expect(result.enforcementAction.actionType).toBe('RESTRICT');
    expect(result.outgoingEvent).not.toBeNull();
    expect(result.outgoingEvent!.status).toBe('PENDING');
    expect(result.outgoingEvent!.enforcementActionId).toBe(ACTION_ID);
    expect(result.outgoingEvent!.webhookUrl).toBe(WEBHOOK_URL);
    expect(result.outgoingEvent!.eventType).toBe('ENFORCEMENT_EXECUTED');
    expect(result.outgoingEvent!.payload).toEqual({
      enforcement_action_id: ACTION_ID,
      case_id: CASE_ID,
      action_type: 'RESTRICT',
      target_type: 'CUSTOMER',
      target_id: CUSTOMER_ID,
      organization_id: ORG_1,
    });
    expect(Object.keys(result.outgoingEvent!.payload).sort()).toEqual([
      'action_type',
      'case_id',
      'enforcement_action_id',
      'organization_id',
      'target_id',
      'target_type',
    ]);
    expect(enforcementActions.all()[0]?.status).toBe('EXECUTED');
    expect(outgoingEvents.all()).toHaveLength(1);
    expect(outgoingEvents.all()[0]?.status).toBe('PENDING');
    expect(cases.all()[0]?.status).toBe(caseStatusBefore);
    expect(auditRecorder.all()).toHaveLength(1);
    expect(auditRecorder.all()[0]?.action).toBe('EXECUTE_ENFORCEMENT_ACTION');
  });

  it('auto-executes PENDING REVIEW without approval and writes outbox when URL is set', async () => {
    const review = buildPendingAction({
      id: generateEnforcementActionId(),
      actionType: 'REVIEW',
    });
    const { executeEnforcementAction, outgoingEvents } = buildUseCase({ seedAction: review });

    const result = await executeEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: review.id,
    });

    expect(result.enforcementAction.status).toBe('EXECUTED');
    expect(result.outgoingEvent).not.toBeNull();
    expect(result.outgoingEvent!.payload).toEqual(expect.objectContaining({ action_type: 'REVIEW' }));
    expect(outgoingEvents.all()).toHaveLength(1);
  });

  it.each(['BLOCK', 'RESTRICT', 'SUSPEND', 'DELETE'] as const)(
    'fails closed for %s without outbound webhook URL (no EXECUTED, no outbox)',
    async (actionType: EnforcementActionType) => {
      const action = buildApprovedAction({
        id: generateEnforcementActionId(),
        actionType: createEnforcementActionType(actionType),
      });
      const { executeEnforcementAction, enforcementActions, outgoingEvents, auditRecorder } = buildUseCase({
        seedAction: action,
        webhookUrl: null,
      });

      await expect(
        executeEnforcementAction({
          auth: SUPERVISOR,
          enforcementActionId: action.id,
        }),
      ).rejects.toMatchObject({
        code: 'INVARIANT_VIOLATION',
      } satisfies Partial<CaseManagementError>);

      expect(enforcementActions.all()[0]?.status).toBe('APPROVED');
      expect(outgoingEvents.all()).toHaveLength(0);
      expect(auditRecorder.all()).toHaveLength(0);
    },
  );

  it('fails closed when fraud config is missing for non-REVIEW actions', async () => {
    const { executeEnforcementAction, enforcementActions, outgoingEvents } = buildUseCase({
      seedAction: buildApprovedAction(),
      skipFraudConfig: true,
    });

    await expect(
      executeEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    } satisfies Partial<CaseManagementError>);

    expect(enforcementActions.all()[0]?.status).toBe('APPROVED');
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('fails closed when outbound webhook URL is empty string for BLOCK', async () => {
    const { executeEnforcementAction, enforcementActions, outgoingEvents } = buildUseCase({
      seedAction: buildApprovedAction(),
      webhookUrl: '   ',
    });

    await expect(
      executeEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({
      code: 'INVARIANT_VIOLATION',
    } satisfies Partial<CaseManagementError>);

    expect(enforcementActions.all()[0]?.status).toBe('APPROVED');
    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('executes REVIEW without outbox when webhook URL is missing', async () => {
    const review = buildPendingAction({
      id: generateEnforcementActionId(),
      actionType: 'REVIEW',
    });
    const { executeEnforcementAction, enforcementActions, outgoingEvents, auditRecorder } = buildUseCase({
      seedAction: review,
      webhookUrl: null,
    });

    const result = await executeEnforcementAction({
      auth: SUPERVISOR,
      enforcementActionId: review.id,
    });

    expect(result.enforcementAction.status).toBe('EXECUTED');
    expect(result.outgoingEvent).toBeNull();
    expect(enforcementActions.all()[0]?.status).toBe('EXECUTED');
    expect(outgoingEvents.all()).toHaveLength(0);
    expect(auditRecorder.all()[0]?.action).toBe('EXECUTE_ENFORCEMENT_ACTION');
  });

  it('rejects PENDING non-REVIEW actions that are not APPROVED', async () => {
    const { executeEnforcementAction, outgoingEvents } = buildUseCase({
      seedAction: buildPendingAction({ actionType: 'BLOCK' }),
    });

    await expect(
      executeEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    } satisfies Partial<CaseManagementError>);

    expect(outgoingEvents.all()).toHaveLength(0);
  });

  it('rejects REJECTED actions and does not write outbox', async () => {
    const rejected = buildPendingAction().reject(NOW);
    const { executeEnforcementAction, outgoingEvents } = buildUseCase({ seedAction: rejected });

    await expect(
      executeEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    } satisfies Partial<CaseManagementError>);

    expect(outgoingEvents.all()).toHaveLength(0);
  });

  /** ADMIN incluido: ejecutar una sancion es operacion, no gobierno (SoD). */
  it.each([
    ['ANALYST', () => ANALYST],
    ['AUDITOR', () => AUDITOR],
    ['ADMIN', () => ADMIN],
  ])('rejects %s with FORBIDDEN_ROLE', async (_role, actor) => {
    const { executeEnforcementAction } = buildUseCase({ seedAction: buildApprovedAction() });

    await expect(
      executeEnforcementAction({
        auth: actor(),
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' } satisfies Partial<CaseManagementError>);
  });

  it('rejects cross-tenant access', async () => {
    const { executeEnforcementAction } = buildUseCase({
      seedAction: buildApprovedAction({ organizationId: ORG_2 }),
      seedCase: buildCase({ organizationId: ORG_2 }),
    });

    await expect(
      executeEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    } satisfies Partial<CaseManagementError>);
  });

  it('returns ENFORCEMENT_ACTION_NOT_FOUND when action is missing', async () => {
    const { executeEnforcementAction } = buildUseCase();

    await expect(
      executeEnforcementAction({
        auth: SUPERVISOR,
        enforcementActionId: ACTION_ID,
      }),
    ).rejects.toMatchObject({
      code: 'ENFORCEMENT_ACTION_NOT_FOUND',
    } satisfies Partial<CaseManagementError>);
  });
});
