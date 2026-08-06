import { createOrganizationStatus } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationStatus.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';

describe('createOrganizationStatus', () => {
  it.each(['ACTIVE', 'SUSPENDED', 'CANCELLED'] as const)('accepts the valid value %s', (value) => {
    expect(createOrganizationStatus(value)).toBe(value);
  });

  it('rejects a value outside the closed 3-value set', () => {
    expect(() => createOrganizationStatus('DISABLED')).toThrow(IdentityAccessError);
  });

  it('rejects the old 4-value LifecycleStatus member INACTIVE — organizations no longer use it', () => {
    expect(() => createOrganizationStatus('INACTIVE')).toThrow(IdentityAccessError);
  });

  it('rejects an empty string', () => {
    expect(() => createOrganizationStatus('')).toThrow(IdentityAccessError);
  });
});
