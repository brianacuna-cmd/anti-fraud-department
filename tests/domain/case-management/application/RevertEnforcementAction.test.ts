import { oid } from '../../../support/oid.js';
import { createRevertEnforcementActionUseCase } from '../../../../src/modules/case-management/application/RevertEnforcementAction.js';
import { EnforcementAction } from '../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { createEnforcementActionId } from '../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ACTION_ID = oid('ea-1');
const CASE_ID = oid('case-1');

const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildAction(organizationId = ORG_1): EnforcementAction {
  return EnforcementAction.create({
    id: createEnforcementActionId(ACTION_ID),
    caseId: createCaseId(CASE_ID),
    organizationId,
    analystDecisionId: createAnalystDecisionId(oid('ad-1')),
    actionType: 'BLOCK',
    targetType: 'CUSTOMER',
    targetId: 'customer-1',
    createdBy: oid('an-1'),
    now: NOW,
  });
}

function executed(organizationId = ORG_1): EnforcementAction {
  return buildAction(organizationId).approve(NOW).execute(NOW);
}

function build(seed?: EnforcementAction) {
  const enforcementActions = new InMemoryEnforcementActionRepository();
  if (seed) void enforcementActions.save(seed);
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const outbox = new InMemoryOutboxEventRepository();
  const revertEnforcementAction = createRevertEnforcementActionUseCase({
    enforcementActions,
    auditRecorder,
    outbox,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateOutboxEventId,
  });
  return { revertEnforcementAction, enforcementActions, auditRecorder, outbox };
}

describe('createRevertEnforcementActionUseCase', () => {
  it('reverts an EXECUTED action, emits ENFORCEMENT_REVERTED outbox + audit', async () => {
    const h = build(executed());

    const result = await h.revertEnforcementAction({ auth: SUPERVISOR, enforcementActionId: ACTION_ID });

    expect(result.status).toBe('REVERTED');
    expect(h.enforcementActions.all()[0]?.status).toBe('REVERTED');
    const events = h.outbox.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('ENFORCEMENT_REVERTED');
    expect(events[0]?.aggregateType).toBe('enforcement_actions');
    expect(events[0]?.aggregateId).toBe(ACTION_ID);
    expect(events[0]?.status).toBe('PENDING');
    expect(events[0]?.payload).toMatchObject({ enforcement_action_id: ACTION_ID, status: 'REVERTED' });
    expect(h.auditRecorder.all()[0]?.action).toBe('REVERT_ENFORCEMENT_ACTION');
  });

  it('rejects reverting a non-EXECUTED action with INVALID_TRANSITION', async () => {
    const h = build(buildAction().approve(NOW)); // APPROVED, not executed
    await expect(
      h.revertEnforcementAction({ auth: SUPERVISOR, enforcementActionId: ACTION_ID }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' } satisfies Partial<CaseManagementError>);
    expect(h.outbox.all()).toHaveLength(0);
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const h = build(executed());
    await expect(
      h.revertEnforcementAction({ auth: ANALYST, enforcementActionId: ACTION_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('throws ENFORCEMENT_ACTION_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(
      h.revertEnforcementAction({ auth: SUPERVISOR, enforcementActionId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'ENFORCEMENT_ACTION_NOT_FOUND' });
  });

  it('rejects cross-tenant with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build(executed(ORG_2));
    await expect(
      h.revertEnforcementAction({ auth: SUPERVISOR, enforcementActionId: ACTION_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
