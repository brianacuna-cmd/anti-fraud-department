import { createAdminKeyStatus } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminKeyStatus.js';

describe('createAdminKeyStatus', () => {
  it.each(['ACTIVE', 'DEPRECATED', 'REVOKED'] as const)('accepts %s', (value) => {
    expect(createAdminKeyStatus(value)).toBe(value);
  });

  it('rejects an unknown status as an invariant violation', () => {
    expect(() => createAdminKeyStatus('SUSPENDED')).toThrow(/ACTIVE, DEPRECATED, REVOKED/);
  });

  it('rejects an empty string', () => {
    expect(() => createAdminKeyStatus('')).toThrow(/ACTIVE, DEPRECATED, REVOKED/);
  });
});
