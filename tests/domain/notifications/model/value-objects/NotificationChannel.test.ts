import {
  CHANNELS,
  createNotificationChannel,
} from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';

describe('createNotificationChannel', () => {
  it('accepts EMAIL', () => {
    expect(createNotificationChannel('EMAIL')).toBe('EMAIL');
  });

  it('rejects an unknown channel as UNKNOWN_CHANNEL', () => {
    expect.assertions(1);
    try {
      createNotificationChannel('SMS');
    } catch (error) {
      expect((error as { code: string }).code).toBe('UNKNOWN_CHANNEL');
    }
  });
});

describe('CHANNELS catalog', () => {
  it('contains exactly EMAIL', () => {
    expect(CHANNELS).toEqual(['EMAIL']);
  });
});
