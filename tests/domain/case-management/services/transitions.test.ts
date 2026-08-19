import {
  caseStatusTransitions,
  enforcementActionStatusTransitions,
} from '../../../../src/modules/case-management/domain/services/transitions.js';

describe('caseStatusTransitions', () => {
  it('allows the forward path OPEN -> IN_REVIEW -> RESOLVED -> ARCHIVED', () => {
    expect(caseStatusTransitions.OPEN).toEqual(['IN_REVIEW']);
    expect(caseStatusTransitions.IN_REVIEW).toEqual(['RESOLVED']);
  });

  it('allows T6 reopen edges from RESOLVED and ARCHIVED', () => {
    expect(caseStatusTransitions.RESOLVED).toEqual(expect.arrayContaining(['OPEN', 'IN_REVIEW', 'ARCHIVED']));
    expect(caseStatusTransitions.ARCHIVED).toEqual(expect.arrayContaining(['OPEN', 'IN_REVIEW']));
  });
});

describe('enforcementActionStatusTransitions', () => {
  it('allows EXECUTED -> REVERTED (post-execution reversal)', () => {
    expect(enforcementActionStatusTransitions.EXECUTED).toEqual(['REVERTED']);
  });

  it('defines REVERTED as a terminal state', () => {
    expect(Object.keys(enforcementActionStatusTransitions)).toContain('REVERTED');
    expect(enforcementActionStatusTransitions.REVERTED).toEqual([]);
  });
});
