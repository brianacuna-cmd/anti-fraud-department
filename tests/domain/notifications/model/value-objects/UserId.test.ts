import { createUserId } from '../../../../../src/modules/notifications/domain/model/value-objects/UserId.js';

describe('createUserId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createUserId('user-123');

    expect(id).toBe('user-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createUserId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createUserId('   ')).toThrow(/non-empty/);
  });
});
