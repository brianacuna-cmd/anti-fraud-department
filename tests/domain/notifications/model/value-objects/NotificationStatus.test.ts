import {
  NOTIFICATION_STATUSES,
  createNotificationStatus,
} from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationStatus.js';

describe('createNotificationStatus', () => {
  it.each(['UNREAD', 'READ'])('accepts %s', (status) => {
    expect(createNotificationStatus(status)).toBe(status);
  });

  it('rejects an unknown status as UNKNOWN_NOTIFICATION_STATUS', () => {
    expect.assertions(1);
    try {
      createNotificationStatus('ARCHIVED');
    } catch (error) {
      expect((error as { code: string }).code).toBe('UNKNOWN_NOTIFICATION_STATUS');
    }
  });
});

describe('NOTIFICATION_STATUSES catalog', () => {
  it('contains exactly UNREAD and READ', () => {
    expect(NOTIFICATION_STATUSES).toEqual(['UNREAD', 'READ']);
  });
});
