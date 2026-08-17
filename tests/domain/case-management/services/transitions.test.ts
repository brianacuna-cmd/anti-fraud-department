import {
  caseStatusTransitions,
  enforcementActionStatusTransitions,
} from '../../../../src/modules/case-management/domain/services/transitions.js';

describe('caseStatusTransitions', () => {
  it('allows the forward path OPEN -> IN_REVIEW -> RESOLVED -> ARCHIVED', () => {
    expect(caseStatusTransitions.OPEN).toEqual(['IN_REVIEW', 'RESOLVED']);
    expect(caseStatusTransitions.IN_REVIEW).toEqual(['RESOLVED']);
  });

  it('allows T6 reopen edges from RESOLVED and ARCHIVED', () => {
    expect(caseStatusTransitions.RESOLVED).toEqual(expect.arrayContaining(['OPEN', 'IN_REVIEW', 'ARCHIVED']));
    expect(caseStatusTransitions.ARCHIVED).toEqual(expect.arrayContaining(['OPEN', 'IN_REVIEW']));
  });
});

describe('enforcementActionStatusTransitions', () => {
  it('has no outgoing edges from EXECUTED (REVERTED removed as dead code)', () => {
    expect(enforcementActionStatusTransitions.EXECUTED).toEqual([]);
  });

  it('does not define a REVERTED key in the transition table', () => {
    expect(Object.keys(enforcementActionStatusTransitions)).not.toContain('REVERTED');
  });
});
