import {
  createAdminOrganizationId,
  generateAdminOrganizationId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';

const HEX = 'a'.repeat(24);

describe('createAdminOrganizationId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createAdminOrganizationId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createAdminOrganizationId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createAdminOrganizationId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateAdminOrganizationId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateAdminOrganizationId();
    const second = generateAdminOrganizationId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
