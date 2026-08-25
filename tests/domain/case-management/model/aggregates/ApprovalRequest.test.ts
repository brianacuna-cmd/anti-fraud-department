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

/* -------------------------------------------------------------------------- */
/* Cuatro ojos                                                                 */
/* -------------------------------------------------------------------------- */

describe('ApprovalRequest dual control', () => {
  const REQUESTER = oid('user-1');
  const OTHER = oid('user-2');

  /**
   * El control entero se reduce a esto. Si esta prueba se cae, una sola
   * persona puede pedir una sancion y ejecutarla sin que nadie la mire.
   */
  it('refuses to let the requester approve their own request', () => {
    const request = build({ requesterId: REQUESTER });

    expect(() => request.approve({ reviewerId: REQUESTER, reviewerComment: 'ok', now: LATER }))
      .toThrow(expect.objectContaining({ code: 'SELF_APPROVAL_FORBIDDEN' }));
  });

  /**
   * And reject too. Letting the requester withdraw their own request looks
   * harmless, but it turns the review queue into something one person can
   * empty without anyone looking.
   */
  it('refuses to let the requester reject their own request', () => {
    const request = build({ requesterId: REQUESTER });

    expect(() => request.reject({ reviewerId: REQUESTER, reviewerComment: 'me lo pensé mejor', now: LATER }))
      .toThrow(expect.objectContaining({ code: 'SELF_APPROVAL_FORBIDDEN' }));
  });

  it('leaves the request untouched when self-review is refused', () => {
    const request = build({ requesterId: REQUESTER });

    expect(() => request.approve({ reviewerId: REQUESTER, reviewerComment: null, now: LATER })).toThrow();

    expect(request.status).toBe('PENDING');
    expect(request.reviewerId).toBeNull();
    expect(request.reviewedAt).toBeNull();
  });

  it.each([
    ['approve', 'APPROVED'],
    ['reject', 'REJECTED'],
  ])('lets a second person %s it', (method, expected) => {
    const request = build({ requesterId: REQUESTER });

    const decided =
      method === 'approve'
        ? request.approve({ reviewerId: OTHER, reviewerComment: 'revisado', now: LATER })
        : request.reject({ reviewerId: OTHER, reviewerComment: 'revisado', now: LATER });

    expect(decided.status).toBe(expected);
    expect(decided.reviewerId).toBe(OTHER);
    expect(decided.reviewedAt).toBe(LATER);
  });

  /** La comprobacion de cuatro ojos corre ANTES que la de transicion. */
  it('reports self-review, not an invalid transition, on an already-decided request', () => {
    const decided = build({ requesterId: REQUESTER }).approve({
      reviewerId: OTHER,
      reviewerComment: 'revisado',
      now: LATER,
    });

    expect(() => decided.approve({ reviewerId: REQUESTER, reviewerComment: null, now: LATER }))
      .toThrow(expect.objectContaining({ code: 'SELF_APPROVAL_FORBIDDEN' }));
  });
});
