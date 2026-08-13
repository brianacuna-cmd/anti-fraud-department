import {
  createOrganizationId,
  generateOrganizationId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';

const HEX = 'a'.repeat(24);

describe('createOrganizationId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createOrganizationId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createOrganizationId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createOrganizationId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});

describe('generateOrganizationId', () => {
  it('generates a unique 24-char hex id on every call', () => {
    const first = generateOrganizationId();
    const second = generateOrganizationId();

    expect(first).toMatch(/^[a-f0-9]{24}$/);
    expect(first).not.toBe(second);
  });
});
