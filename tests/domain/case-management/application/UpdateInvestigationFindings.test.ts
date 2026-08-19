import { oid } from '../../../support/oid.js';
import { createOpenInvestigationUseCase } from '../../../../src/modules/case-management/application/OpenInvestigation.js';
import { createUpdateInvestigationFindingsUseCase } from '../../../../src/modules/case-management/application/UpdateInvestigationFindings.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryInvestigationRepository } from '../../../helpers/case-management/InMemoryInvestigationRepository.js';
import { InMemoryCaseManagementAuditRecorder } from '../../../helpers/case-management/InMemoryCaseManagementAuditRecorder.js';
import { PassthroughUnitOfWork } from '../../../../src/modules/case-management/infrastructure/PassthroughUnitOfWork.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });
const OTHER = createAuthContext({ userId: oid('x'), organizationId: oid('org-2'), actorType: 'USER', roleId: 'ANALYST' });

function build() {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const deps = { cases, investigations, auditRecorder, unitOfWork: new PassthroughUnitOfWork(), clock: new FixedClock(NOW) };
  return {
    cases,
    investigations,
    auditRecorder,
    openInvestigation: createOpenInvestigationUseCase({ ...deps, generateInvestigationId }),
    updateInvestigationFindings: createUpdateInvestigationFindingsUseCase(deps),
  };
}

async function seedOpen(h: ReturnType<typeof build>) {
  await h.cases.save(
    Case.create({
      id: createCaseId(oid('case-1')),
      organizationId: ORG_1,
      customerId: 'customer-1',
      riskScore: createRiskScore(50),
      priority: 'MEDIUM',
      now: NOW,
    }),
  );
  return h.openInvestigation({ auth: ANALYST, caseId: oid('case-1'), subjectType: 'WALLET', subjectId: 'w-1' });
}

describe('createUpdateInvestigationFindingsUseCase', () => {
  it('records JSON findings + exploration depth and an UPDATE_INVESTIGATION_FINDINGS audit', async () => {
    const h = build();
    const opened = await seedOpen(h);

    const findings = { nodes: 12, ring: 'A', linkedWallets: ['w-2', 'w-3'] };
    const updated = await h.updateInvestigationFindings({
      auth: ANALYST,
      investigationId: opened.id,
      findings,
      explorationDepth: 3,
    });

    expect(updated.findingsData).toEqual(findings);
    expect(updated.explorationDepth).toBe(3);
    expect(h.investigations.all()[0]?.findingsData).toEqual(findings);
    expect(h.auditRecorder.all().map((a) => a.action)).toEqual([
      'OPEN_INVESTIGATION',
      'UPDATE_INVESTIGATION_FINDINGS',
    ]);
    expect(h.auditRecorder.all()[1]?.detail).toMatchObject({ explorationDepth: 3 });
  });

  it('allows overwriting findings on a subsequent update', async () => {
    const h = build();
    const opened = await seedOpen(h);
    await h.updateInvestigationFindings({ auth: ANALYST, investigationId: opened.id, findings: { a: 1 }, explorationDepth: 1 });
    const second = await h.updateInvestigationFindings({ auth: ANALYST, investigationId: opened.id, findings: { b: 2 }, explorationDepth: 5 });

    expect(second.findingsData).toEqual({ b: 2 });
    expect(second.explorationDepth).toBe(5);
  });

  it('rejects a negative exploration depth with INVARIANT_VIOLATION', async () => {
    const h = build();
    const opened = await seedOpen(h);

    await expect(
      h.updateInvestigationFindings({ auth: ANALYST, investigationId: opened.id, findings: { a: 1 }, explorationDepth: -1 }),
    ).rejects.toMatchObject({ code: 'INVARIANT_VIOLATION' } satisfies Partial<CaseManagementError>);
  });

  it('throws INVESTIGATION_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(
      h.updateInvestigationFindings({ auth: ANALYST, investigationId: oid('missing'), findings: { a: 1 }, explorationDepth: 1 }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });

  it('throws forbiddenCrossTenant for another organization', async () => {
    const h = build();
    const opened = await seedOpen(h);
    await expect(
      h.updateInvestigationFindings({ auth: OTHER, investigationId: opened.id, findings: { a: 1 }, explorationDepth: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
