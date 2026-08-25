import {
  CHANNELS,
  CONFIGURABLE_CHANNELS,
  createNotificationChannel,
} from '../../../../../src/modules/notifications/domain/model/value-objects/NotificationChannel.js';

describe('createNotificationChannel', () => {
  it.each(['EMAIL', 'IN_APP'])('accepts %s', (channel) => {
    expect(createNotificationChannel(channel)).toBe(channel);
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
  it('contains every deliverable channel', () => {
    expect(CHANNELS).toEqual(['EMAIL', 'IN_APP']);
  });

  it('exposes only EMAIL as configurable, so the in-app inbox cannot be silenced', () => {
    // Being able to mute the inbox would mean an analyst is assigned a
    // case with no record that they were notified.
    expect(CONFIGURABLE_CHANNELS).toEqual(['EMAIL']);
    expect(CONFIGURABLE_CHANNELS).not.toContain('IN_APP');
  });
});
