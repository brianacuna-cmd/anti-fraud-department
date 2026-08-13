import {
  createCaseId,
  generateCaseId,
} from '../../../../../src/modules/case-management/domain/model/value-objects/CaseId.js';
import { CaseManagementError } from '../../../../../src/modules/case-management/domain/errors/CaseManagementError.js';

const HEX = 'a'.repeat(24);

describe('createCaseId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createCaseId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createCaseId('')).toThrow(CaseManagementError);
    expect(() => createCaseId('not-an-objectid')).toThrow(CaseManagementError);
  });
});

describe('generateCaseId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateCaseId();
    const second = generateCaseId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
