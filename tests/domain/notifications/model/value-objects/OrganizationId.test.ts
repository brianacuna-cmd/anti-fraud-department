import {
  createOrganizationId,
} from '../../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';

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
