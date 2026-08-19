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
    // Poder apagar la bandeja significaria que a un analista se le asigna un
    // expediente sin constancia de que se le aviso.
    expect(CONFIGURABLE_CHANNELS).toEqual(['EMAIL']);
    expect(CONFIGURABLE_CHANNELS).not.toContain('IN_APP');
  });
});
