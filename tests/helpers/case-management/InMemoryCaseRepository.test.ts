import { oid } from '../../support/oid.js';
import { InMemoryCaseRepository } from './InMemoryCaseRepository.js';
import { Case } from '../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { fromDate } from '../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildCase(id: string, organizationId: string, idempotencyKey?: string | null): Case {
  return Case.create({
    id: createCaseId(id),
    organizationId,
    customerId: 'customer-1',
    riskScore: createRiskScore(42),
    priority: 'MEDIUM',
    idempotencyKey,
    now: NOW,
  });
}

describe('InMemoryCaseRepository#findByIdempotencyKey', () => {
  it('returns the matching Case for the same org and key', async () => {
    const repo = new InMemoryCaseRepository();
    const kase = buildCase(oid('case-1'), oid('org-1'), 'idem-1');
    await repo.save(kase);

    const found = await repo.findByIdempotencyKey(oid('org-1'), 'idem-1');

    expect(found?.id).toBe(oid('case-1'));
  });

  it('returns null when the stored Case has a null idempotencyKey, even if org matches', async () => {
    const repo = new InMemoryCaseRepository();
    await repo.save(buildCase(oid('case-1'), oid('org-1'), null));

    const found = await repo.findByIdempotencyKey(oid('org-1'), 'idem-1');

    expect(found).toBeNull();
  });

  it('returns null across different orgs with the same key', async () => {
    const repo = new InMemoryCaseRepository();
    await repo.save(buildCase(oid('case-1'), oid('org-1'), 'idem-1'));

    const found = await repo.findByIdempotencyKey(oid('org-2'), 'idem-1');

    expect(found).toBeNull();
  });

  it('returns null when the key differs', async () => {
    const repo = new InMemoryCaseRepository();
    await repo.save(buildCase(oid('case-1'), oid('org-1'), 'idem-1'));

    const found = await repo.findByIdempotencyKey(oid('org-1'), 'other-key');

    expect(found).toBeNull();
  });
});
