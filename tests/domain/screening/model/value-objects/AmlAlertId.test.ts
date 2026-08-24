import {
  createAmlAlertId,
  generateAmlAlertId,
} from '../../../../../src/modules/screening/domain/model/value-objects/AmlAlertId.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('AmlAlertId', () => {
  it('accepts a 24-char hex string', () => {
    const raw = '507f1f77bcf86cd799439011';
    expect(createAmlAlertId(raw)).toBe(raw);
  });

  it('rejects a non-hex value', () => {
    expect(() => createAmlAlertId('bad')).toThrow(ScreeningError);
  });

  it('generates a fresh valid id', () => {
    const id = generateAmlAlertId();
    expect(createAmlAlertId(id)).toBe(id);
  });
});
