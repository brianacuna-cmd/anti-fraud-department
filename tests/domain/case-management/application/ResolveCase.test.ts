import { oid } from '../../../support/oid.js';
import { createResolveCaseUseCase } from '../../../../src/modules/case-management/application/ResolveCase.js';
import { createArchiveCaseUseCase } from '../../../../src/modules/case-management/application/ArchiveCase.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { generateResolutionId } from '../../../../src/modules/case-management/domain/model/value-objects/ResolutionId.js';
import { generateTimelineEventId } from '../../../../src/modules/case-management/domain/model/value-objects/TimelineEventId.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { InMemoryResolutionRepository } from '../../../helpers/case-management/InMemoryResolutionRepository.js';
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
    now: NOW,
  });
}

function build() {
  const cases = new InMemoryCaseRepository();
  const resolutions = new InMemoryResolutionRepository();
  const timelineRecorder = new InMemoryTimelineRecorder();
  const auditRecorder = new InMemoryCaseManagementAuditRecorder();
  const deps = {
    cases,
    resolutions,
    timelineRecorder,
    auditRecorder,
    unitOfWork: new PassthroughUnitOfWork(),
    clock: new FixedClock(NOW),
    generateResolutionId,
    generateTimelineEventId,
  };
  return {
    cases,
    resolutions,
    timelineRecorder,
    auditRecorder,
    resolveCase: createResolveCaseUseCase(deps),
    archiveCase: createArchiveCaseUseCase(deps),
  };
}

describe('createResolveCaseUseCase', () => {
  it('resolves an OPEN case: status RESOLVED + resolution row + STATE_CHANGED timeline + RESOLVE_CASE audit', async () => {
    const { cases, resolutions, timelineRecorder, auditRecorder, resolveCase } = build();
    await cases.save(buildCase());

    const resolved = await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legitimate' });

    expect(resolved.status).toBe('RESOLVED');
    const rows = await resolutions.listByCaseId(createCaseId(oid('case-1')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.closureType).toBe('RESOLVED');
    expect(rows[0]?.reason).toBe('legitimate');
    const timeline = timelineRecorder.all();
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('STATE_CHANGED');
    expect(timeline[0]?.previousValue).toBe('OPEN');
    expect(timeline[0]?.newValue).toBe('RESOLVED');
    expect(auditRecorder.all()[0]?.action).toBe('RESOLVE_CASE');
  });

  it('rejects a non-supervisor with FORBIDDEN_ROLE', async () => {
    const { cases, resolveCase } = build();
    await cases.save(buildCase());

    await expect(
      resolveCase({ auth: ANALYST, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
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
    const { cases, resolutions, auditRecorder, resolveCase, archiveCase } = build();
    await cases.save(buildCase());
    await resolveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'legit' });

    const archived = await archiveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'filed' });

    expect(archived.status).toBe('ARCHIVED');
    const rows = await resolutions.listByCaseId(createCaseId(oid('case-1')));
    expect(rows.map((r) => r.closureType)).toEqual(['RESOLVED', 'ARCHIVED']);
    expect(auditRecorder.all().map((a) => a.action)).toEqual(['RESOLVE_CASE', 'ARCHIVE_CASE']);
  });

  it('rejects archiving an OPEN case with INVALID_TRANSITION', async () => {
    const { cases, archiveCase } = build();
    await cases.save(buildCase());

    await expect(
      archiveCase({ auth: SUPERVISOR, caseId: oid('case-1'), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
