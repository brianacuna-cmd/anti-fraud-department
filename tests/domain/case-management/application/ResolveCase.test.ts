import { oid } from '../../../support/oid.js';
import { createResolveCaseUseCase } from '../../../../src/modules/case-management/application/ResolveCase.js';
import { createArchiveCaseUseCase } from '../../../../src/modules/case-management/application/ArchiveCase.js';
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
  };
  return {
    cases,
    resolutions,
    decisions,
    enforcementActions,
    timelineRecorder,
    auditRecorder,
    outbox,
    resolveCase: createResolveCaseUseCase(deps),
    archiveCase: createArchiveCaseUseCase(deps),
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

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legitimate' });

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

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legit' });

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
   * An OPEN case can never have a decision on file (recording one requires
   * `assertInstructed`, which requires a note/evidence, which requires
   * review first) — so `assertDecided` now rejects before the transition
   * table even gets a chance to. Still the same root cause (never reviewed),
   * just reported at the step that actually explains it to the caller.
   */
  it('rejects resolving straight from OPEN with CASE_NOT_DECIDED (review + decide gates, in order)', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase());

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_DECIDED' });
  });

  it('rejects resolving an IN_REVIEW case with no decision yet (CASE_NOT_DECIDED)', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'CASE_NOT_DECIDED' });
  });

  it('rejects resolving a FRAUD_CONFIRMED case with no enforcement action requested (CASE_ENFORCEMENT_PENDING)', async () => {
    const { cases, decisions, resolveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions, 'FRAUD_CONFIRMED');

    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'CASE_ENFORCEMENT_PENDING' });
  });

  it('rejects a non-supervisor with FORBIDDEN_ROLE', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase());

    await expect(
      resolveCase({ auth: ANALYST, caseId: oid('case-1'), reason: 'x' }),
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
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    expect((await cases.findById(createCaseId(oid('case-1'))))?.status).toBe('IN_REVIEW');
    expect(await resolutions.listByCaseId(createCaseId(oid('case-1')))).toHaveLength(0);
    expect(timelineRecorder.all()).toHaveLength(0);
    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const { resolveCase } = build();
    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('missing'), reason: 'x' }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase(ORG_2));
    await expect(
      resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

describe('createArchiveCaseUseCase', () => {
  it('archives a RESOLVED case (RESOLVED -> ARCHIVED) and appends a second resolution row', async () => {
    const { cases, resolutions, decisions, auditRecorder, resolveCase, archiveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions);
    await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legit' });

    const archived = await archiveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'filed' });

    expect(archived.status).toBe('ARCHIVED');
    const rows = await resolutions.listByCaseId(createCaseId(oid('case-1')));
    expect(rows.map((r) => r.closureType)).toEqual(['RESOLVED', 'ARCHIVED']);
    expect(auditRecorder.all().map((a) => a.action)).toEqual(['RESOLVE_CASE', 'ARCHIVE_CASE']);
  });

  it('does NOT emit an outbox event on archive (only resolve does)', async () => {
    const { cases, outbox, decisions, resolveCase, archiveCase } = build();
    await cases.save(buildCase().transitionTo('IN_REVIEW', NOW));
    await seedDecision(decisions);
    await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legit' });
    await archiveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'filed' });

    // exactly one — from resolve, not archive
    expect(outbox.all()).toHaveLength(1);
    expect(outbox.all()[0]?.eventType).toBe('CASE_RESOLVED');
  });

  it('rejects archiving an OPEN case with INVALID_TRANSITION', async () => {
    const { cases, archiveCase } = build();
    await cases.save(buildCase());

    await expect(
      archiveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
