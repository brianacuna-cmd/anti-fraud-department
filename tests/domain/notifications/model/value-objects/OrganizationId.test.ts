import { createOrganizationId } from '../../../../../src/modules/notifications/domain/model/value-objects/OrganizationId.js';

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
