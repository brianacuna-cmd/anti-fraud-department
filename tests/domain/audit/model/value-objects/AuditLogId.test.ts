import {
  createAuditLogId,
  generateAuditLogId,
} from '../../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createAuditLogId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createAuditLogId('audit-log-123');

    expect(id).toBe('audit-log-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createAuditLogId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createAuditLogId('   ')).toThrow(/non-empty/);
  });
});

describe('generateAuditLogId', () => {
  it('generates a fresh id on every call', () => {
    const first = generateAuditLogId();
    const second = generateAuditLogId();

    expect(first).not.toBe(second);
  });

  it('returns a parseable UUID', () => {
    const id = generateAuditLogId();

    expect(id).toMatch(UUID_PATTERN);
  });
});
