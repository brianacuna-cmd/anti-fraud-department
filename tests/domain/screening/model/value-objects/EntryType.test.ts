import { createEntryType } from '../../../../../src/modules/screening/domain/model/value-objects/EntryType.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createEntryType', () => {
  it.each(['PERSON', 'ORGANIZATION', 'WALLET'])('accepts %s', (value) => {
    expect(createEntryType(value)).toBe(value);
  });

  it('rejects an unknown entry type', () => {
    expect(() => createEntryType('VEHICLE')).toThrow(ScreeningError);
  });
});
