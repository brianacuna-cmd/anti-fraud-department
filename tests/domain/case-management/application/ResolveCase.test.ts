import { oid } from '../../../support/oid.js';
import { createResolveCaseUseCase } from '../../../../src/modules/case-management/application/ResolveCase.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { AnalystDecision } from '../../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAnalystDecisionType } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionType.js';
import { generateAnalystDecisionId } from '../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { generateResolutionId } from '../../../../src/modules/case-management/domain/model/value-objects/ResolutionId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { generateOutboxEventId } from '../../../../src/shared/outbox/OutboxEventId.js';
import { createEnqueueCustomerWebhookFanOut } from '../../../../src/modules/case-management/application/EnqueueCustomerWebhookFanOut.js';
import { CustomerWebhookSubscription } from '../../../../src/modules/case-management/domain/model/aggregates/CustomerWebhookSubscription.js';
import { generateCustomerWebhookSubscriptionId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerWebhookSubscriptionId.js';
import { generateCustomerOutgoingEventId } from '../../../../src/modules/case-management/domain/model/value-objects/CustomerOutgoingEventId.js';
import { InMemoryCustomerWebhookSubscriptionRepository } from '../../../helpers/case-management/InMemoryCustomerWebhookSubscriptionRepository.js';
import { InMemoryCustomerOutgoingEventRepository } from '../../../helpers/case-management/InMemoryCustomerOutgoingEventRepository.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryOutboxEventRepository } from '../../../helpers/case-management/InMemoryOutboxEventRepository.js';
import { InMemoryResolutionRepository } from '../../../helpers/case-management/InMemoryResolutionRepository.js';
import { InMemoryAnalystDecisionRepository } from '../../../helpers/case-management/InMemoryAnalystDecisionRepository.js';
import { InMemoryEnforcementActionRepository } from '../../../helpers/case-management/InMemoryEnforcementActionRepository.js';
import { InMemoryTimelineRecorder } from '../../../helpers/case-management/InMemoryTimelineRecorder.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const SUPERVISOR = createAuthContext({ userId: oid('sup-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'SUPERVISOR' });
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    // Assignment rule freezes orphan cases:
    // without an owner they cannot be worked.
    assignedTo: createAssignedTo('USER', oid('analyst-1')),
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const resolutions = new InMemoryResolutionRepository();
  const decisions = new InMemoryAnalystDecisionRepository();
  const enforcementActions = new InMemoryEnforcementActionRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const outbox = new InMemoryOutboxEventRepository();
  const subscriptions = new InMemoryCustomerWebhookSubscriptionRepository();
  const outgoingEvents = new InMemoryCustomerOutgoingEventRepository();
  const deps = {
    cases,
    resolutions,
    decisions,
    enforcementActions,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateResolutionId,
    generateTimelineEventId,
    outbox,
    generateOutboxEventId,
    enqueueCustomerWebhookFanOut: createEnqueueCustomerWebhookFanOut({
      subscriptions,
      outgoingEvents,
      generateCustomerOutgoingEventId,
    }),
  };
  return {
    cases,
    resolutions,
    decisions,
    enforcementActions,
    timelineRecorder,
    auditRecorder,
    outbox,
    outgoingEvents,
    subscriptions,
    resolveCase: createResolveCaseUseCase(deps),
  };
}

/** Resolving requires a decision on file. See `WorkflowStepGate.assertDecided`. */
async function seedDecision(
  decisions: InMemoryAnalystDecisionRepository,
  decisionType: 'FALSE_POSITIVE' | 'FRAUD_CONFIRMED' | 'INCONCLUSIVE' = 'FALSE_POSITIVE',
): Promise<void> {
  await decisions.save(
    AnalystDecision.create({
      id: generateAnalystDecisionId(),
      caseId: createCaseId(oid('case-1')),
      organizationId: ORG_1,
      decision: createAnalystDecisionType(decisionType),
      confidence: 80,
      comment: 'instructed verdict',
      createdBy: oid('analyst-1'),
      now: NOW,
    }),
  );
}

describe('createResolveCaseUseCase', () => {
  it('resolves an IN_REVIEW case: status RESOLVED + resolution row + STATE_CHANGED timeline + RESOLVE_CASE audit', async () => {
    const { cases, resolutions, decisions, timelineRecorder, auditRecorder, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions);

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legitimate', outcome: 'FALSE_POSITIVE' });

    expect(resolved.status).toBe('RESOLVED');
    const rows = await resolutions.listByCaseId(createCaseId(oid('case-1')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.closureType).toBe('RESOLVED');
    expect(rows[0]?.reason).toBe('legitimate');
    const timeline = timelineRecorder.all();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('STATE_CHANGED');
    expect(timeline[0]?.previousValue).toBe('IN_REVIEW');
    expect(timeline[0]?.newValue).toBe('RESOLVED');
    expect(auditRecorder.all()[0]?.action).toBe('RESOLVE_CASE');
  });

  it('stops the SLA (clears dueDate) and emits a CASE_RESOLVED outbox event in the same tx', async () => {
    const { cases, outbox, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW).withDueDate(NOW, NOW));
    await seedDecision(decisions);

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legit', outcome: 'FALSE_POSITIVE' });

    expect(resolved.dueDate).toBeNull();
    expect(cases.all()[0]?.dueDate).toBeNull();
    const events = outbox.all();
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('CASE_RESOLVED');
    expect(events[0]?.aggregateType).toBe('cases');
    expect(events[0]?.aggregateId).toBe(oid('case-1'));
    expect(events[0]?.status).toBe('PENDING');
    expect(events[0]?.payload).toMatchObject({ case_id: oid('case-1'), closure_type: 'RESOLVED' });
  });

  /**
   * An OPEN case with no decision on file — so `resolveClosureVerdict` rejects before the transition
   * table even gets a chance to. Still the same root cause (never reviewed),
   * just reported at the step that actually explains it to the caller.
   */
  it('rejects resolving straight from OPEN with CASE_NOT_DECIDED (review + decide gates, in order)', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase());

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'FALSE_POSITIVE' }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_DECIDED' });
  });

  it('rejects resolving an IN_REVIEW case with no decision yet (CASE_NOT_DECIDED)', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'FALSE_POSITIVE' }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_DECIDED' });
  });

  it('rejects resolving a FRAUD_CONFIRMED case with no enforcement action requested (CASE_ENFORCEMENT_PENDING)', async () => {
    const { cases, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'FRAUD_CONFIRMED');

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'FRAUD_CONFIRMED' }),
    ).rejects.toMatchObject({ code: 'CASE_ENFORCEMENT_PENDING' });
  });

  it('rejects a non-supervisor with FORBIDDEN_ROLE', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase());

    await expect(
      resolveCase({ auth: ANALYST, caseId: oid('case-1'), reason: 'x', outcome: 'FALSE_POSITIVE' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('rejects system:agent ANALYST with FORBIDDEN_ROLE and leaves repositories unchanged', async () => {
    const { cases, resolutions, decisions, timelineRecorder, auditRecorder, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions);
    await expect(
      resolveCase({
        auth: createAuthContext({ userId: 'system:agent', organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' }),
        caseId: oid('case-1'),
        reason: 'x',
        outcome: 'FALSE_POSITIVE',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect((await cases.findById(createCaseId(oid('case-1'))))?.status).toBe('IN_REVIEW');
    expect(await resolutions.listByCaseId(createCaseId(oid('case-1')))).toHaveLength(0);
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('stores the outcome on the resolution, the case read-model, the audit row and the CASE_RESOLVED payload', async () => {
    const { cases, resolutions, decisions, auditRecorder, outbox, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'INCONCLUSIVE');

    const resolved = await resolveCase({
      auth: SUPERVISOR,
      caseId: oid('case-1'),
      reason: 'nothing conclusive',
      outcome: 'INSUFFICIENT_EVIDENCE',
    });

    expect(resolved.resolutionOutcome).toBe('INSUFFICIENT_EVIDENCE');
    expect((await cases.findById(createCaseId(oid('case-1'))))?.resolutionOutcome).toBe('INSUFFICIENT_EVIDENCE');
    const [row] = await resolutions.listByCaseId(createCaseId(oid('case-1')));
    expect(row?.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(auditRecorder.all()[0]?.detail).toMatchObject({ outcome: 'INSUFFICIENT_EVIDENCE' });
    expect(outbox.all()[0]?.payload).toMatchObject({ outcome: 'INSUFFICIENT_EVIDENCE' });
  });

  it('takes outcome and reason from the latest decision when both are omitted', async () => {
    const { cases, decisions, resolutions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'INCONCLUSIVE');

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1') });

    expect(resolved.resolutionOutcome).toBe('INSUFFICIENT_EVIDENCE');
    const [resolution] = await resolutions.listByCaseId(createCaseId(oid('case-1')));
    expect(resolution?.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(resolution?.reason).toBe('instructed verdict');
  });

  it('closes a case with no decision only for a procedural outcome', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    await expect(resolveCase({ auth: SUPERVISOR, caseId: oid('case-1') })).rejects.toMatchObject({
      code: 'CASE_NOT_DECIDED',
    });
    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), outcome: 'FALSE_POSITIVE' }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_DECIDED' });

    const resolved = await resolveCase({
      auth: SUPERVISOR,
      caseId: oid('case-1'),
      outcome: 'DUPLICATE',
      reason: 'same customer as FD-2026-000001',
    });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('rejects an outcome that contradicts the decision (CASE_OUTCOME_CONTRADICTS_DECISION)', async () => {
    const { cases, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'FALSE_POSITIVE');

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'INSUFFICIENT_EVIDENCE' }),
    ).rejects.toMatchObject({ code: 'CASE_OUTCOME_CONTRADICTS_DECISION' });
  });

  it('checks the outcome against the LATEST decision, not the first one', async () => {
    const { cases, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'INCONCLUSIVE');
    await decisions.save(
      AnalystDecision.create({
        id: generateAnalystDecisionId(),
        caseId: createCaseId(oid('case-1')),
        organizationId: ORG_1,
        decision: createAnalystDecisionType('FALSE_POSITIVE'),
        confidence: 90,
        comment: 'documents cleared it',
        createdBy: oid('analyst-1'),
        now: fromDate(new Date('2026-01-02T00:00:00.000Z')),
      }),
    );

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'FALSE_POSITIVE' });
    expect(resolved.resolutionOutcome).toBe('FALSE_POSITIVE');
  });

  it('accepts the procedural outcomes on top of any decision', async () => {
    const { cases, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'INCONCLUSIVE');

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'DUPLICATE' });
    expect(resolved.resolutionOutcome).toBe('DUPLICATE');
  });

  it('resolves straight from PENDING_DOCUMENTATION when the documents never arrive', async () => {
    const { cases, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW).transitionTo('PENDING_DOCUMENTATION', NOW));
    await seedDecision(decisions, 'INCONCLUSIVE');

    const resolved = await resolveCase({
      auth: SUPERVISOR,
      caseId: oid('case-1'),
      reason: 'customer did not answer',
      outcome: 'DOCUMENTATION_NOT_PROVIDED',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolutionOutcome).toBe('DOCUMENTATION_NOT_PROVIDED');
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const { resolveCase } = build();
    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('missing'), reason: 'x', outcome: 'FALSE_POSITIVE' }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase(ORG_2));
    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x', outcome: 'FALSE_POSITIVE' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

