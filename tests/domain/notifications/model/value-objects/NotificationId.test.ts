import { createNotificationId, generateNotificationId } from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationId.js';
import { oid } from '../../../../support/oid.js';

describe('NotificationId', () => {
  it('accepts a 24-char hex ObjectId string', () => {
    const id = createNotificationId(oid('notification-1'));
    expect(id).toBe(oid('notification-1'));
  });

  it('rejects a malformed value', () => {
    expect(() => createNotificationId('not-an-object-id')).toThrow();
  });

  it('generateNotificationId mints a fresh valid 24-char hex id', () => {
    const id = generateNotificationId();
    expect(() => createNotificationId(id)).not.toThrow();
  });

  it('generateNotificationId mints distinct ids on successive calls', () => {
    const a = generateNotificationId();
    const b = generateNotificationId();
    expect(a).not.toBe(b);
  });
});
