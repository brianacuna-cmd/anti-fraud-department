import {
  createBulkScreeningJobId,
  generateBulkScreeningJobId,
} from '../../../../../src/modules/screening/domain/model/value-objects/BulkScreeningJobId.js';
import { ScreeningError } from '../../../../../src/modules/screening/domain/errors/ScreeningError.js';

describe('BulkScreeningJobId', () => {
  it('accepts a 24-char hex string', () => {
    const raw = '507f1f77bcf86cd799439011';
    expect(createBulkScreeningJobId(raw)).toBe(raw);
  });

  it('rejects a non-hex value', () => {
    expect(() => createBulkScreeningJobId('bad')).toThrow(ScreeningError);
  });

  it('rejects an empty string', () => {
    expect(() => createBulkScreeningJobId('')).toThrow(ScreeningError);
  });

  it('generates a fresh valid id that passes createBulkScreeningJobId', () => {
    const id = generateBulkScreeningJobId();
    expect(createBulkScreeningJobId(id)).toBe(id);
  });
});
