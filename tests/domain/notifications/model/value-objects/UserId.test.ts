import {
  createUserId,
} from '../../../../../src/modules/notifications/domain/model/value-objects/UserId.js';

const HEX = 'a'.repeat(24);

describe('createUserId', () => {
  it('accepts a 24-character hexadecimal ObjectId', () => {
    expect(createUserId(HEX)).toBe(HEX);
  });

  it('rejects a value that is not a 24-character hex ObjectId', () => {
    expect(() => createUserId('')).toThrow(/24-character hexadecimal ObjectId/);
    expect(() => createUserId('not-an-objectid')).toThrow(/24-character hexadecimal ObjectId/);
  });
});
