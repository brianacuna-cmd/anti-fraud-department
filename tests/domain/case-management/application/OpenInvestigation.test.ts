import { oid } from '../../../support/oid.js';
import { createOpenInvestigationUseCase } from '../../../../src/modules/case-management/application/OpenInvestigation.js';
import { createListInvestigationsUseCase } from '../../../../src/modules/case-management/application/ListInvestigations.js';
import { createGetInvestigationUseCase } from '../../../../src/modules/case-management/application/GetInvestigation.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createAssignedTo } from '../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
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
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

function buildCase(organizationId = ORG_1): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    // La regla de asignacion congela los expedientes huerfanos:
    // sin responsable no se pueden trabajar.
    assignedTo: createAssignedTo('USER', oid('analyst-1')),
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const investigations = new InMemoryInvestigationRepository();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const openInvestigation = createOpenInvestigationUseCase({
    cases,
    investigations,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateInvestigationId,
  });
  const listInvestigations = createListInvestigationsUseCase({ cases, investigations });
  const getInvestigation = createGetInvestigationUseCase({ investigations });
  return { cases, investigations, auditRecorder, openInvestigation, listInvestigations, getInvestigation };
}

describe('createOpenInvestigationUseCase', () => {
  it('opens an investigation + OPEN_INVESTIGATION audit (any authenticated actor)', async () => {
    const { cases, investigations, auditRecorder, openInvestigation } = build();
    await cases.save(buildCase());

    const investigation = await openInvestigation({
      auth: ANALYST,
      caseId: oid('case-1'),
      subjectType: 'WALLET',
      subjectId: 'wallet-abc',
    });

    expect(investigation.status).toBe('OPEN');
    expect((await investigations.listByCaseId(createCaseId(oid('case-1')))).map((i) => i.subjectId)).toEqual([
      'wallet-abc',
    ]);
    expect(auditRecorder.all()[0]?.action).toBe('OPEN_INVESTIGATION');
    expect(auditRecorder.all()[0]?.resource).toBe('investigation');
  });

  it('rejects an unknown subjectType', async () => {
    const { cases, openInvestigation } = build();
    await cases.save(buildCase());
    await expect(
      openInvestigation({ auth: ANALYST, caseId: oid('case-1'), subjectType: 'IP', subjectId: 'x' }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const { openInvestigation } = build();
    await expect(
      openInvestigation({ auth: ANALYST, caseId: oid('missing'), subjectType: 'EMAIL', subjectId: 'x' }),
    ).rejects.toBeInstanceOf(CaseManagementError);
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const { cases, openInvestigation } = build();
    await cases.save(buildCase(ORG_2));
    await expect(
      openInvestigation({ auth: ANALYST, caseId: oid('case-1'), subjectType: 'EMAIL', subjectId: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});

describe('list + get investigation', () => {
  it('lists a case investigations and gets one by id (tenant-gated)', async () => {
    const { cases, openInvestigation, listInvestigations, getInvestigation } = build();
    await cases.save(buildCase());
    const opened = await openInvestigation({
      auth: ANALYST,
      caseId: oid('case-1'),
      subjectType: 'CUSTOMER',
      subjectId: 'cust-9',
    });

    const listed = await listInvestigations({ auth: ANALYST, caseId: oid('case-1') });
    expect(listed).toHaveLength(1);

    const fetched = await getInvestigation({ auth: ANALYST, investigationId: opened.id });
    expect(fetched.id).toBe(opened.id);
  });

  it('getInvestigation throws INVESTIGATION_NOT_FOUND when missing', async () => {
    const { getInvestigation } = build();
    await expect(
      getInvestigation({ auth: ANALYST, investigationId: oid('missing') }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });
});
