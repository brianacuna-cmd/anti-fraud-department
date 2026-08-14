import { oid } from '../../../../support/oid.js';
import { ApprovalRequest } from '../../../../../src/modules/case-management/domain/model/aggregates/ApprovalRequest.js';
import { createApprovalRequestId } from '../../../../../src/modules/case-management/domain/model/value-objects/ApprovalRequestId.js';
import { createEnforcementActionId } from '../../../../../src/modules/case-management/domain/model/value-objects/EnforcementActionId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T01:00:00.000Z'));

function build(
  overrides: Partial<Parameters<typeof ApprovalRequest.create>[0]> = {},
): ApprovalRequest {
  return ApprovalRequest.create({
    id: createApprovalRequestId(oid('approval-1')),
    enforcementActionId: createEnforcementActionId(oid('action-1')),
    requesterId: oid('user-1'),
    now: NOW,
    ...overrides,
  });
}

describe('ApprovalRequest.create', () => {
  it('starts PENDING with null reviewer fields', () => {
    const request = build();

    expect(request.status).toBe('PENDING');
    expect(request.reviewerId).toBeNull();
    expect(request.reviewerComment).toBeNull();
    expect(request.reviewedAt).toBeNull();
    expect(request.requesterId).toBe(oid('user-1'));
  });
});

describe('ApprovalRequest transitions', () => {
  it('approves PENDING -> APPROVED with reviewer metadata', () => {
    const request = build().approve({
      reviewerId: oid('supervisor-1'),
      reviewerComment: 'ok',
      now: LATER,
    });

    expect(request.status).toBe('APPROVED');
    expect(request.reviewerId).toBe(oid('supervisor-1'));
    expect(request.reviewerComment).toBe('ok');
    expect(request.reviewedAt).toBe(LATER);
  });

  it('rejects PENDING -> REJECTED with reviewer metadata', () => {
    const request = build().reject({
      reviewerId: oid('supervisor-1'),
      reviewerComment: 'no',
      now: LATER,
    });

    expect(request.status).toBe('REJECTED');
    expect(request.reviewerComment).toBe('no');
  });

  it('rejects a second decision after APPROVED', () => {
    const approved = build().approve({
      reviewerId: oid('supervisor-1'),
      reviewerComment: null,
      now: NOW,
    });

    expect(() =>
      approved.reject({ reviewerId: oid('supervisor-2'), reviewerComment: null, now: LATER }),
    ).toThrow('cannot transition');
  });
});
