import { oid } from '../../../support/oid.js';
import { createOpenInvestigationUseCase } from '../../../../src/modules/case-management/application/OpenInvestigation.js';
import { createCloseInvestigationUseCase } from '../../../../src/modules/case-management/application/CloseInvestigation.js';
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
    closeInvestigation: createCloseInvestigationUseCase(deps),
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

describe('createCloseInvestigationUseCase', () => {
  it('closes an open investigation with findings + CLOSE_INVESTIGATION audit', async () => {
    const h = build();
    const opened = await seedOpen(h);

    const closed = await h.closeInvestigation({
      auth: ANALYST,
      investigationId: opened.id,
      findings: 'confirmed fraud',
    });

    expect(closed.status).toBe('CLOSED');
    expect(closed.findings).toBe('confirmed fraud');
    expect(h.auditRecorder.all().map((a) => a.action)).toEqual(['OPEN_INVESTIGATION', 'CLOSE_INVESTIGATION']);
  });

  it('throws INVESTIGATION_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(
      h.closeInvestigation({ auth: ANALYST, investigationId: oid('missing'), findings: 'x' }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });

  it('throws forbiddenCrossTenant for another organization', async () => {
    const h = build();
    const opened = await seedOpen(h);
    await expect(
      h.closeInvestigation({ auth: OTHER, investigationId: opened.id, findings: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });

  it('rejects closing an already-CLOSED investigation with INVALID_TRANSITION', async () => {
    const h = build();
    const opened = await seedOpen(h);
    await h.closeInvestigation({ auth: ANALYST, investigationId: opened.id, findings: 'first' });
    await expect(
      h.closeInvestigation({ auth: ANALYST, investigationId: opened.id, findings: 'again' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
