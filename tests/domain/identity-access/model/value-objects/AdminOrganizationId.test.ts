import {
  createAdminOrganizationId,
  generateAdminOrganizationId,
} from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';

describe('createAdminOrganizationId', () => {
  it('accepts a non-empty string and returns it unchanged', () => {
    const id = createAdminOrganizationId('admin-org-123');

    expect(id).toBe('admin-org-123');
  });

  it('rejects an empty string as an invariant violation', () => {
    expect(() => createAdminOrganizationId('')).toThrow(/non-empty/);
  });

  it('rejects a whitespace-only string as an invariant violation', () => {
    expect(() => createAdminOrganizationId('   ')).toThrow(/non-empty/);
  });
});

describe('generateAdminOrganizationId', () => {
  it('generates a fresh, non-empty id on every call', () => {
    const first = generateAdminOrganizationId();
    const second = generateAdminOrganizationId();

    expect(first.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });
});
