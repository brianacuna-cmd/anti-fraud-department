import { oid } from '../../../../support/oid.js';
import { AnalystDecision } from '../../../../../src/modules/case-management/domain/model/aggregates/AnalystDecision.js';
import { createAnalystDecisionId } from '../../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function build(overrides: Partial<Parameters<typeof AnalystDecision.create>[0]> = {}): AnalystDecision {
  return AnalystDecision.create({
    id: createAnalystDecisionId(oid('decision-1')),
    caseId: createCaseId(oid('case-1')),
    organizationId: oid('org-1'),
    decision: 'FRAUD_CONFIRMED',
    confidence: 80,
    comment: 'confirmed by analyst',
    createdBy: oid('user-1'),
    now: NOW,
    ...overrides,
  });
}

describe('AnalystDecision.create', () => {
  it('persists FRAUD_CONFIRMED with confidence and comment', () => {
    const decision = build();

    expect(decision.decision).toBe('FRAUD_CONFIRMED');
    expect(decision.confidence).toBe(80);
    expect(decision.comment).toBe('confirmed by analyst');
    expect(decision.caseId).toBe(oid('case-1'));
    expect(decision.organizationId).toBe(oid('org-1'));
    expect(decision.createdBy).toBe(oid('user-1'));
    expect(decision.createdAt).toBe(NOW);
  });

  it('accepts FALSE_POSITIVE and INCONCLUSIVE decisions', () => {
    expect(build({ decision: 'FALSE_POSITIVE' }).decision).toBe('FALSE_POSITIVE');
    expect(build({ decision: 'INCONCLUSIVE', confidence: 0 }).decision).toBe('INCONCLUSIVE');
  });

  it('rejects confidence outside 0–100', () => {
    expect(() => build({ confidence: -1 })).toThrow(CaseManagementError);
    expect(() => build({ confidence: 101 })).toThrow(CaseManagementError);
  });

  it('rejects an empty organizationId', () => {
    expect(() => build({ organizationId: '   ' })).toThrow(CaseManagementError);
  });
});

describe('AnalystDecision.rehydrate', () => {
  it('reconstructs from persisted props without validation', () => {
    const decision = build();
    const rehydrated = AnalystDecision.rehydrate(decision.toProps());

    expect(rehydrated.id).toBe(decision.id);
    expect(rehydrated.decision).toBe('FRAUD_CONFIRMED');
  });
});
