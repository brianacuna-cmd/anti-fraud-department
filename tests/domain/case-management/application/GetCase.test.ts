import { oid } from '../../../support/oid.js';
import { createGetCaseUseCase } from '../../../../src/modules/case-management/application/GetCase.js';
import { Case } from '../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { InMemoryCaseRepository } from '../../../helpers/case-management/InMemoryCaseRepository.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { CaseManagementError } from '../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const ORG_1 = oid('org-1');
const ORG_2 = oid('org-2');
const ANALYST = createAuthContext({ userId: oid('analyst-1'), organizationId: ORG_1, actorType: 'USER' });

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

describe('createGetCaseUseCase', () => {
  it('returns the case for the owning tenant', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(buildCase());
    const getCase = createGetCaseUseCase({ cases });

    const kase = await getCase({ auth: ANALYST, caseId: oid('case-1') });

    expect(kase.id).toBe(oid('case-1'));
    expect(kase.organizationId).toBe(ORG_1);
  });

  it('throws caseNotFound when the case does not exist', async () => {
    const getCase = createGetCaseUseCase({ cases: new InMemoryCaseRepository() });

    await expect(getCase({ auth: ANALYST, caseId: oid('missing') })).rejects.toBeInstanceOf(
      CaseManagementError,
    );
  });

  it('throws forbiddenCrossTenant for a case in another organization', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(buildCase(ORG_2));
    const getCase = createGetCaseUseCase({ cases });

    await expect(getCase({ auth: ANALYST, caseId: oid('case-1') })).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    });
  });
});
