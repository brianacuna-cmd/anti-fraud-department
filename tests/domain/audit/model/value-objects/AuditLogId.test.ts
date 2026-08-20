import {
  createAuditLogId,
  generateAuditLogId,
} from '../../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';

const HEX = 'a'.repeat(24);

describe('createAuditLogId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createAuditLogId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createAuditLogId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createAuditLogId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateAuditLogId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateAuditLogId();
    const second = generateAuditLogId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
