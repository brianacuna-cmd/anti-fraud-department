import { createMatchField } from '../../../../../src/modules/screening/domain/model/value-objects/MatchField.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createMatchField', () => {
  it.each(['NAME', 'DOCUMENT', 'WALLET'])('accepts %s', (value) => {
    expect(createMatchField(value)).toBe(value);
  });

  it('rejects an unknown match field', () => {
    expect(() => createMatchField('EMAIL')).toThrow(ScreeningError);
  });
});
