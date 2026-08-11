import {
  NotificationsError,
  invariantViolation,
  forbiddenCrossTenant,
  unknownAlertType,
  unknownChannel,
} from '../../../../src/modules/notifications/domain/errors/NotificationsError.js';

describe('NotificationsError factories', () => {
  it('invariantViolation produces INVARIANT_VIOLATION with the given message/metadata', () => {
    const error = invariantViolation('bad input', { value: 'x' });

    expect(error).toBeInstanceOf(NotificationsError);
    expect(error.code).toBe('INVARIANT_VIOLATION');
    expect(error.message).toBe('bad input');
    expect(error.metadata).toEqual({ value: 'x' });
  });

  it('forbiddenCrossTenant produces FORBIDDEN_CROSS_TENANT', () => {
    const error = forbiddenCrossTenant();

    expect(error).toBeInstanceOf(NotificationsError);
    expect(error.code).toBe('FORBIDDEN_CROSS_TENANT');
  });

  it('unknownAlertType produces UNKNOWN_ALERT_TYPE with the offending value', () => {
    const error = unknownAlertType('not_a_real_type');

    expect(error).toBeInstanceOf(NotificationsError);
    expect(error.code).toBe('UNKNOWN_ALERT_TYPE');
    expect(error.metadata).toEqual({ value: 'not_a_real_type' });
  });

  it('unknownChannel produces UNKNOWN_CHANNEL with the offending value', () => {
    const error = unknownChannel('SMS');

    expect(error).toBeInstanceOf(NotificationsError);
    expect(error.code).toBe('UNKNOWN_CHANNEL');
    expect(error.metadata).toEqual({ value: 'SMS' });
  });
});
