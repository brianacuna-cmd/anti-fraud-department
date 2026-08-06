import {
  createSessionId,
  generateSessionId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createSessionId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createSessionId('session-123');

    expect(id).toBe('session-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createSessionId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createSessionId('   ')).toThrow(/non-empty/);
  });
});

describe('generateSessionId', () => {
  it('generates a fresh id on every call', () => {
    const first = generateSessionId();
    const second = generateSessionId();

    expect(first).not.toBe(second);
  });

  it('returns a parseable UUID (design D37)', () => {
    const id = generateSessionId();

    expect(id).toMatch(UUID_PATTERN);
  });
});
