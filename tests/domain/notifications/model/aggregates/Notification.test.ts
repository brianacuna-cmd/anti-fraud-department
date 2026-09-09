import { oid } from '../../../../support/oid.js';
import { Notification } from '../../../../../src/modules/notifications/domain/model/aggregates/Notification.js';
import { createNotificationId } from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { createOrganizationId } from '../../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';
import { createUserId } from '../../../../../src/modules/notifications/domain/model/value-objects/UserId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function baseInput() {
  return {
    id: createNotificationId(oid('notification-1')),
    organizationId: createOrganizationId(oid('org-1')),
    recipientUserId: createUserId(oid('user-1')),
    alertType: 'CASE_ASSIGNED' as const,
    channel: 'EMAIL' as const,
    context: { caseId: oid('case-1') },
    now: NOW,
  };
}

describe('Notification.create', () => {
  it('stamps createdAt from now and carries props verbatim', () => {
    const notification = Notification.create(baseInput());

    expect(notification.id).toBe(oid('notification-1'));
    expect(notification.organizationId).toBe(oid('org-1'));
    expect(notification.recipientUserId).toBe(oid('user-1'));
    expect(notification.alertType).toBe('CASE_ASSIGNED');
    expect(notification.channel).toBe('EMAIL');
    expect(notification.context).toEqual({ caseId: oid('case-1') });
    expect(notification.createdAt).toBe(NOW);
  });

  it('defaults status to UNREAD and stamps updatedAt from now', () => {
    const notification = Notification.create(baseInput());

    expect(notification.status).toBe('UNREAD');
    expect(notification.updatedAt).toBe(NOW);
  });
});

describe('Notification.rehydrate', () => {
  it('reconstructs from persisted props with no validation', () => {
    const props = {
      id: createNotificationId(oid('notification-1')),
      organizationId: createOrganizationId(oid('org-1')),
      recipientUserId: createUserId(oid('user-1')),
      alertType: 'SLA_DUE_SOON' as const,
      channel: 'EMAIL' as const,
      context: {},
      createdAt: NOW,
      status: 'READ' as const,
      updatedAt: NOW,
    };

    const notification = Notification.rehydrate(props);

    expect(notification.alertType).toBe('SLA_DUE_SOON');
    expect(notification.createdAt).toBe(NOW);
    expect(notification.status).toBe('READ');
    expect(notification.updatedAt).toBe(NOW);
  });
});

describe('Notification.markRead', () => {
  const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

  it('transitions UNREAD to READ and returns a new instance with updated updatedAt', () => {
    const notification = Notification.create(baseInput());

    const marked = notification.markRead(LATER);

    expect(marked).not.toBe(notification);
    expect(marked.status).toBe('READ');
    expect(marked.updatedAt).toBe(LATER);
    expect(notification.status).toBe('UNREAD');
    expect(notification.updatedAt).toBe(NOW);
  });

  it('is an idempotent no-op when already READ', () => {
    const notification = Notification.create(baseInput()).markRead(LATER);

    const markedAgain = notification.markRead(fromDate(new Date('2026-01-03T00:00:00.000Z')));

    expect(markedAgain.status).toBe('READ');
    expect(markedAgain.updatedAt).toBe(LATER);
  });
});

describe('Notification immutability', () => {
  it('exposes only readonly getters, no setters', () => {
    const notification = Notification.create(baseInput());

    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(notification), 'alertType')?.set).toBeUndefined();
  });

  it('toProps() returns the full persisted shape', () => {
    const notification = Notification.create(baseInput());

    expect(notification.toProps()).toEqual({
      id: oid('notification-1'),
      organizationId: oid('org-1'),
      recipientUserId: oid('user-1'),
      alertType: 'CASE_ASSIGNED',
      channel: 'EMAIL',
      context: { caseId: oid('case-1') },
      createdAt: NOW,
      status: 'UNREAD',
      updatedAt: NOW,
    });
  });
});
