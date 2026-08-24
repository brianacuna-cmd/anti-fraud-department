import { createAmlAlertSeverity } from '../../../../../src/modules/screening/domain/model/value-objects/AmlAlertSeverity.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createAmlAlertSeverity', () => {
  it.each(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])('accepts %s', (value) => {
    expect(createAmlAlertSeverity(value)).toBe(value);
  });

  it('rejects an unknown severity', () => {
    expect(() => createAmlAlertSeverity('URGENT')).toThrow(ScreeningError);
  });
});
