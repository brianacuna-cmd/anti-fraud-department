import { oid } from '../../../support/oid.js';
import { createExportCasesUseCase } from '../../../../src/modules/case-management/application/ExportCases.js';
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

const AUDITOR = createAuthContext({ userId: oid('aud-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'AUDITOR' });
const ANALYST = createAuthContext({ userId: oid('an-1'), organizationId: ORG_1, actorType: 'USER', roleId: 'ANALYST' });

let seq = 0;
function buildCase(overrides: { organizationId?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' } = {}): Case {
  seq += 1;
  return Case.create({
    id: createCaseId(oid(`case-${seq}`)),
    organizationId: overrides.organizationId ?? ORG_1,
    customerId: `customer-${seq}`,
    riskScore: createRiskScore(50),
    priority: overrides.priority ?? 'MEDIUM',
    tags: ['fraud'],
    now: NOW,
  });
}

function build(seeds: Case[] = []) {
  const cases = new InMemoryCaseRepository();
  for (const seed of seeds) void cases.save(seed);
  return { cases, exportCases: createExportCasesUseCase({ cases }) };
}

describe('createExportCasesUseCase', () => {
  it('returns tenant-scoped rows with a total for AUDITOR', async () => {
    const h = build([buildCase(), buildCase(), buildCase({ organizationId: ORG_2 })]);

    const result = await h.exportCases({ auth: AUDITOR });

    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.rows.every((c) => c.organizationId === ORG_1)).toBe(true);
  });

  it('applies filters (priority)', async () => {
    const h = build([buildCase({ priority: 'HIGH' }), buildCase({ priority: 'LOW' })]);
    const result = await h.exportCases({ auth: AUDITOR, priority: ['HIGH'] });
    expect(result.total).toBe(1);
    expect(result.rows[0]?.priority).toBe('HIGH');
  });

  it('rejects ANALYST with FORBIDDEN_ROLE', async () => {
    const h = build([buildCase()]);
    await expect(h.exportCases({ auth: ANALYST })).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    } satisfies Partial<CaseManagementError>);
  });
});
