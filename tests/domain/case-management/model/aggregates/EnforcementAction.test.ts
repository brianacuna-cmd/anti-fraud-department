import { oid } from '../../../../support/oid.js';
import { EnforcementAction } from '../../../../../src/modules/case-management/domain/model/aggregates/EnforcementAction.js';
import { createEnforcementActionId } from '../../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { createAnalystDecisionId } from '../../../../../src/modules/case-management/domain/model/value-objects/AnalystDecisionId.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));

function build(
  overrides: Partial<Parameters<typeof EnforcementAction.create>[0]> = {},
): EnforcementAction {
  return EnforcementAction.create({
    id: createEnforcementActionId(oid('action-1')),
    caseId: createCaseId(oid('case-1')),
    organizationId: oid('org-1'),
    analystDecisionId: createAnalystDecisionId(oid('decision-1')),
    actionType: 'BLOCK',
    targetType: 'CUSTOMER',
    targetId: oid('customer-1'),
    createdBy: oid('user-1'),
    now: NOW,
    ...overrides,
  });
}

describe('EnforcementAction.create', () => {
  it('starts at PENDING with caller-supplied action and target fields', () => {
    const action = build();

    expect(action.status).toBe('PENDING');
    expect(action.actionType).toBe('BLOCK');
    expect(action.targetType).toBe('CUSTOMER');
    expect(action.targetId).toBe(oid('customer-1'));
    expect(action.updatedAt).toBe(NOW);
  });

  it('accepts REVIEW and other action types', () => {
    expect(build({ actionType: 'REVIEW' }).actionType).toBe('REVIEW');
    expect(build({ actionType: 'RESTRICT' }).actionType).toBe('RESTRICT');
  });
});

describe('EnforcementAction status transitions', () => {
  it('approves PENDING -> APPROVED', () => {
    const action = build().approve(LATER);

    expect(action.status).toBe('APPROVED');
    expect(action.updatedAt).toBe(LATER);
  });

  it('rejects PENDING -> REJECTED', () => {
    expect(build().reject(LATER).status).toBe('REJECTED');
  });

  it('executes APPROVED -> EXECUTED', () => {
    expect(build().approve(NOW).execute(LATER).status).toBe('EXECUTED');
  });

  it('allows REVIEW to execute directly from PENDING', () => {
    expect(build({ actionType: 'REVIEW' }).execute(LATER).status).toBe('EXECUTED');
  });

  it('rejects execute from PENDING for non-REVIEW actions', () => {
    expect(() => build({ actionType: 'BLOCK' }).execute(LATER)).toThrow('cannot transition');
  });

  it('rejects approve from REJECTED', () => {
    expect(() => build().reject(NOW).approve(LATER)).toThrow('cannot transition');
  });

  it('reverts an EXECUTED action to REVERTED', () => {
    const reverted = build().approve(NOW).execute(NOW).revert(LATER);
    expect(reverted.status).toBe('REVERTED');
  });

  it('rejects revert from a non-EXECUTED status', () => {
    expect(() => build().approve(NOW).revert(LATER)).toThrow('cannot transition');
  });

  it('keeps REVERTED as a terminal state', () => {
    const reverted = build().approve(NOW).execute(NOW).revert(NOW);
    expect(() => reverted.execute(LATER)).toThrow('cannot transition');
  });
});

describe('EnforcementAction.rehydrate', () => {
  it('reconstructs from persisted props', () => {
    const action = build();
    expect(EnforcementAction.rehydrate(action.toProps()).id).toBe(action.id);
  });
});
