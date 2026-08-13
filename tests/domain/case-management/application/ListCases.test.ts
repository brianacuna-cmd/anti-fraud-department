import { oid } from '../../../support/oid.js';
import { createListCasesUseCase } from '../../../../src/modules/case-management/application/ListCases.js';
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
const NO_TENANT = createAuthContext({ userId: oid('admin'), organizationId: null, actorType: 'USER' });

function seedCase(id: string, organizationId = ORG_1, priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority,
    now: NOW,
  });
}

describe('createListCasesUseCase (inbox)', () => {
  it('lists filtered cases for the actor organization', async () => {
    const cases = new InMemoryCaseRepository();
    await cases.save(seedCase(oid('c-high'), ORG_1, 'HIGH'));
    await cases.save(seedCase(oid('c-med'), ORG_1, 'MEDIUM'));
    await cases.save(seedCase(oid('c-other'), ORG_2, 'HIGH'));
    const listCases = createListCasesUseCase({ cases });

    const page = await listCases({
      auth: ANALYST,
      priority: ['HIGH'],
      limit: 20,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(oid('c-high'));
  });

  it('rejects callers without an organization context', async () => {
    const listCases = createListCasesUseCase({ cases: new InMemoryCaseRepository() });

    await expect(
      listCases({ auth: NO_TENANT, limit: 20, offset: 0 }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN_CROSS_TENANT',
    } satisfies Partial<CaseManagementError>);
  });
});
