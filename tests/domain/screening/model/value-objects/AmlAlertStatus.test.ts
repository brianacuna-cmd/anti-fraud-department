import { createAmlAlertStatus } from '../../../../../src/modules/screening/domain/model/value-objects/AmlAlertStatus.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createAmlAlertStatus', () => {
  it.each(['OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE'])('accepts %s', (value) => {
    expect(createAmlAlertStatus(value)).toBe(value);
  });

  it('rejects an unknown status', () => {
    expect(() => createAmlAlertStatus('CLOSED')).toThrow(ScreeningError);
  });
});
