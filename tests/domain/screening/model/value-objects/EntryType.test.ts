import { createEntryType, isEntryType } from '../../../../../src/modules/screening/domain/model/value-objects/EntryType.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('createEntryType', () => {
  it.each(['PERSON', 'ORGANIZATION', 'WALLET'])('accepts %s', (value) => {
    expect(createEntryType(value)).toBe(value);
  });

  it('rejects an unknown entry type', () => {
    expect(() => createEntryType('VEHICLE')).toThrow(ScreeningError);
  });
});

describe('isEntryType', () => {
  it.each(['PERSON', 'ORGANIZATION', 'WALLET'])('is true for %s', (value) => {
    expect(isEntryType(value)).toBe(true);
  });

  it.each(['VEHICLE', '', 'person', 42, null, undefined, {}])('is false for %p (non-throwing)', (value) => {
    expect(isEntryType(value)).toBe(false);
  });
});
