import {
  createOrganizationId,
  generateOrganizationId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';

describe('createOrganizationId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createOrganizationId('org-123');

    expect(id).toBe('org-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createOrganizationId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createOrganizationId('   ')).toThrow(/non-empty/);
  });
});

describe('generateOrganizationId', () => {
  it('generates a fresh, non-empty id on every call', () => {
    const first = generateOrganizationId();
    const second = generateOrganizationId();

    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });
});
