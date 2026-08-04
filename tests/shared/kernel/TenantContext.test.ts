import { TenantContext } from '../../../src/shared/kernel/TenantContext.js';

describe('TenantContext', () => {
  it('constructs from a raw tenant id and exposes it', () => {
    const tenant = TenantContext.of('org-123');

    expect(tenant.tenantId).toBe('org-123');
  });

  it('treats two contexts built from the same tenant id as equal', () => {
    const a = TenantContext.of('org-123');
    const b = TenantContext.of('org-123');

    expect(a.equals(b)).toBe(true);
  });

  it('treats two contexts built from different tenant ids as not equal', () => {
    const a = TenantContext.of('org-123');
    const b = TenantContext.of('org-456');

    expect(a.equals(b)).toBe(false);
  });

  it('rejects an empty tenant id as an invariant violation', () => {
    expect(() => TenantContext.of('')).toThrow();
  });
});
