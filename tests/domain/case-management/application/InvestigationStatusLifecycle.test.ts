import { oid } from '../../../support/oid.js';
import { createListActiveInvestigationsUseCase } from '../../../../src/modules/case-management/application/ListActiveInvestigations.js';
import { createUpdateInvestigationStatusUseCase } from '../../../../src/modules/case-management/application/UpdateInvestigationStatus.js';
import { Investigation } from '../../../../src/modules/case-management/domain/model/aggregates/Investigation.js';
import { createInvestigationId } from '../../../../src/modules/case-management/domain/model/value-objects/InvestigationId.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
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
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

let seq = 0;
function buildInvestigation(overrides: { id?: string; organizationId?: string } = {}): Investigation {
  seq += 1;
  return Investigation.open({
    id: createInvestigationId(overrides.id ?? oid(`inv-${seq}`)),
    caseId: createCaseId(oid(`case-${seq}`)),
    organizationId: overrides.organizationId ?? ORG_1,
    subjectType: 'WALLET',
    subjectId: `w-${seq}`,
    openedBy: oid('an-1'),
    now: NOW,
  });
}

function build(seeds: Investigation[] = []) {
  const investigations = new InMemoryInvestigationRepository();
  for (const seed of seeds) void investigations.save(seed);
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  return {
    investigations,
    auditRecorder,
    listActiveInvestigations: createListActiveInvestigationsUseCase({ investigations }),
    updateInvestigationStatus: createUpdateInvestigationStatusUseCase({
      investigations,
      auditRecorder,
      unitOfWork: new PassthroughUnitOfWork(),
      clock: new FixedClock(NOW),
    }),
  };
}

describe('createListActiveInvestigationsUseCase', () => {
  it('returns only OPEN/INVESTIGATING investigations for the tenant', async () => {
    const open = buildInvestigation();
    const investigating = buildInvestigation().changeStatus('INVESTIGATING', NOW);
    const resolved = buildInvestigation().changeStatus('RESOLVED', NOW);
    const otherOrg = buildInvestigation({ organizationId: ORG_2 });
    const h = build([open, investigating, resolved, otherOrg]);

    const result = await h.listActiveInvestigations({ auth: ANALYST });

    const ids = result.map((i) => i.id);
    expect(ids).toContain(open.id);
    expect(ids).toContain(investigating.id);
    expect(ids).not.toContain(resolved.id);
    expect(ids).not.toContain(otherOrg.id);
  });
});

describe('createUpdateInvestigationStatusUseCase', () => {
  const INV_ID = oid('inv-fixed');

  it('advances OPEN -> INVESTIGATING and records UPDATE_INVESTIGATION_STATUS', async () => {
    const h = build([buildInvestigation({ id: INV_ID })]);

    const result = await h.updateInvestigationStatus({ auth: ANALYST, investigationId: INV_ID, status: 'INVESTIGATING' });

    expect(result.status).toBe('INVESTIGATING');
    expect(h.investigations.all()[0]?.status).toBe('INVESTIGATING');
    expect(h.auditRecorder.all()[0]?.action).toBe('UPDATE_INVESTIGATION_STATUS');
    expect(h.auditRecorder.all()[0]?.detail).toMatchObject({ previousStatus: 'OPEN', newStatus: 'INVESTIGATING' });
  });

  it('advances INVESTIGATING -> RESOLVED', async () => {
    const h = build([buildInvestigation({ id: INV_ID }).changeStatus('INVESTIGATING', NOW)]);
    const result = await h.updateInvestigationStatus({ auth: ANALYST, investigationId: INV_ID, status: 'RESOLVED' });
    expect(result.status).toBe('RESOLVED');
  });

  it('rejects INVESTIGATING when already RESOLVED with INVALID_TRANSITION', async () => {
    const h = build([buildInvestigation({ id: INV_ID }).changeStatus('RESOLVED', NOW)]);
    await expect(
      h.updateInvestigationStatus({ auth: ANALYST, investigationId: INV_ID, status: 'INVESTIGATING' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' } satisfies Partial<CaseManagementError>);
  });

  it('throws INVESTIGATION_NOT_FOUND when missing', async () => {
    const h = build();
    await expect(
      h.updateInvestigationStatus({ auth: ANALYST, investigationId: oid('missing'), status: 'RESOLVED' }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
  });

  it('rejects a cross-tenant investigation with FORBIDDEN_CROSS_TENANT', async () => {
    const h = build([buildInvestigation({ id: INV_ID, organizationId: ORG_2 })]);
    await expect(
      h.updateInvestigationStatus({ auth: ANALYST, investigationId: INV_ID, status: 'RESOLVED' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_CROSS_TENANT' });
  });
});
