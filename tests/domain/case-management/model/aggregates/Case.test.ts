import { oid } from '../../../../support/oid.js';
import { Case } from '../../../../../src/modules/case-management/domain/model/aggregates/Case.js';
import { createCaseId } from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { createRiskScore } from '../../../../../src/modules/case-management/domain/model/value-objects/RiskScore.js';
import { createAssignedTo } from '../../../../../src/modules/case-management/domain/model/value-objects/AssignedTo.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildCase(): Case {
  return Case.create({
    id: createCaseId(oid('case-1')),
    organizationId: oid('org-1'),
    customerId: 'customer-1',
    riskScore: createRiskScore(50),
    priority: 'MEDIUM',
    now: NOW,
  });
}

describe('Case.create', () => {
  it('starts a new case OPEN, unassigned, with no dueDate', () => {
    const kase = buildCase();

    expect(kase.status).toBe('OPEN');
    expect(kase.assignedTo).toBeNull();
    expect(kase.dueDate).toBeNull();
    expect(kase.tags).toEqual([]);
    expect(kase.createdAt).toBe(NOW);
    expect(kase.updatedAt).toBe(NOW);
    expect(kase.deletedAt).toBeNull();
  });

  it('rejects an empty organizationId', () => {
    expect(() =>
      Case.create({
        id: createCaseId(oid('case-1')),
        organizationId: '   ',
        customerId: 'customer-1',
        riskScore: createRiskScore(50),
        priority: 'MEDIUM',
        now: NOW,
      }),
    ).toThrow(CaseManagementError);
  });
});

describe('Case.rehydrate', () => {
  it('reconstructs a case from stored props without re-validating business rules', () => {
    const kase = Case.rehydrate({
      id: createCaseId(oid('case-1')),
      organizationId: oid('org-1'),
      customerId: 'customer-1',
      customerEmail: null,
      bridgeUserId: null,
      bridgeWallet: null,
      stripeCustomerId: null,
      finturuReference: null,
      finturuCacheSnapshot: null,
      riskScore: createRiskScore(90),
      status: 'RESOLVED',
      priority: 'HIGH',
      assignedTo: createAssignedTo('USER', oid('user-1')),
      dueDate: LATER,
      tags: ['fraud'],
      createdAt: NOW,
      updatedAt: LATER,
      deletedAt: null,
    });

    expect(kase.status).toBe('RESOLVED');
    expect(kase.assignedTo).toEqual({ type: 'USER', id: oid('user-1') });
    expect(kase.dueDate).toBe(LATER);
  });
});

describe('Case#transitionTo', () => {
  it('moves OPEN -> IN_REVIEW on a valid forward transition', () => {
    const kase = buildCase();

    const transitioned = kase.transitionTo('IN_REVIEW', LATER);

    expect(transitioned).not.toBe(kase);
    expect(transitioned.status).toBe('IN_REVIEW');
    expect(transitioned.updatedAt).toBe(LATER);
    expect(kase.status).toBe('OPEN');
  });

  it('rejects an invalid transition and leaves the original instance untouched', () => {
    const kase = buildCase();

    expect(() => kase.transitionTo('ARCHIVED', LATER)).toThrow(CaseManagementError);
    expect(kase.status).toBe('OPEN');
  });
});

describe('Case#reopen', () => {
  it('reopens a RESOLVED case to OPEN', () => {
    const resolved = buildCase().transitionTo('IN_REVIEW', NOW).transitionTo('RESOLVED', NOW);

    const reopened = resolved.reopen('OPEN', LATER);

    expect(reopened.status).toBe('OPEN');
    expect(reopened.updatedAt).toBe(LATER);
  });

  it('reopens an ARCHIVED case to IN_REVIEW', () => {
    const archived = buildCase()
      .transitionTo('IN_REVIEW', NOW)
      .transitionTo('RESOLVED', NOW)
      .transitionTo('ARCHIVED', NOW);

    const reopened = archived.reopen('IN_REVIEW', LATER);

    expect(reopened.status).toBe('IN_REVIEW');
  });

  it('rejects reopening from OPEN', () => {
    const kase = buildCase();

    expect(() => kase.reopen('IN_REVIEW', LATER)).toThrow(CaseManagementError);
  });
});

describe('Case#reassign', () => {
  it('sets a new assignedTo and returns a new instance', () => {
    const kase = buildCase();

    const reassigned = kase.reassign(createAssignedTo('ROLE', 'role-1'), LATER);

    expect(reassigned).not.toBe(kase);
    expect(reassigned.assignedTo).toEqual({ type: 'ROLE', id: 'role-1' });
    expect(kase.assignedTo).toBeNull();
  });

  it('clears assignedTo when given null', () => {
    const kase = buildCase().reassign(createAssignedTo('USER', oid('user-1')), NOW);

    const cleared = kase.reassign(null, LATER);

    expect(cleared.assignedTo).toBeNull();
  });
});

describe('Case#withDueDate', () => {
  it('sets the read-model dueDate copy and returns a new instance', () => {
    const kase = buildCase();

    const withDue = kase.withDueDate(LATER, LATER);

    expect(withDue).not.toBe(kase);
    expect(withDue.dueDate).toBe(LATER);
    expect(kase.dueDate).toBeNull();
  });
});
