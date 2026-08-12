import {
  createOrganizationSchema,
  patchOrganizationSchema,
  updateOrganizationStatusSchema,
} from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/dto/organizationSchemas.js';

const VALID_ADMIN_FIELDS = {
  adminEmail: 'admin@acme.com',
  adminPassword: 'Sup3rSecret',
  adminFirstName: 'Root',
  adminLastName: 'Admin',
};

describe('createOrganizationSchema', () => {
  it('accepts a valid payload with name, slug, and admin bootstrap fields (Atomic Organization Bootstrap)', () => {
    const result = createOrganizationSchema.safeParse({ name: 'Acme', slug: 'acme', ...VALID_ADMIN_FIELDS });

    expect(result.success).toBe(true);
  });

  it('rejects a payload missing the required slug', () => {
    const result = createOrganizationSchema.safeParse({ name: 'Acme', ...VALID_ADMIN_FIELDS });

    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = createOrganizationSchema.safeParse({ name: '', slug: 'acme', ...VALID_ADMIN_FIELDS });

    expect(result.success).toBe(false);
  });

  it('rejects a payload missing the required admin bootstrap fields', () => {
    const result = createOrganizationSchema.safeParse({ name: 'Acme', slug: 'acme' });

    expect(result.success).toBe(false);
  });
});

describe('patchOrganizationSchema (allow-list)', () => {
  it('accepts name and domain', () => {
    const result = patchOrganizationSchema.safeParse({
      name: 'Acme Corp',
      domain: 'acme.com',
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty patch (all fields optional)', () => {
    const result = patchOrganizationSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('rejects a payload attempting to set slug — slug is immutable', () => {
    const result = patchOrganizationSchema.safeParse({ slug: 'new-slug' });

    expect(result.success).toBe(false);
  });

  it('rejects a payload attempting to set an unknown field', () => {
    const result = patchOrganizationSchema.safeParse({ status: 'ACTIVE' });

    expect(result.success).toBe(false);
  });

  it('rejects logoUrl — removed with no replacement DTO field (design D8/A11, task 5.6)', () => {
    const result = patchOrganizationSchema.safeParse({ logoUrl: 'https://acme.com/logo.png' });

    expect(result.success).toBe(false);
  });

  it('rejects configuration — persistence/domain-only, not exposed over HTTP (design A11, task 5.6)', () => {
    const result = patchOrganizationSchema.safeParse({ configuration: { theme: 'dark' } });

    expect(result.success).toBe(false);
  });
});

describe('updateOrganizationStatusSchema (PATCH /organizations/:id/status body, design D10, D21)', () => {
  it.each(['ACTIVE', 'SUSPENDED', 'CANCELLED'])('accepts the valid status %s', (status) => {
    const result = updateOrganizationStatusSchema.safeParse({ status });

    expect(result.success).toBe(true);
  });

  it('rejects the old 4-value LifecycleStatus members INACTIVE/DISABLED — organizations no longer use them', () => {
    expect(updateOrganizationStatusSchema.safeParse({ status: 'INACTIVE' }).success).toBe(false);
    expect(updateOrganizationStatusSchema.safeParse({ status: 'DISABLED' }).success).toBe(false);
  });

  it('rejects a status outside the closed set', () => {
    const result = updateOrganizationStatusSchema.safeParse({ status: 'BORRADO' });

    expect(result.success).toBe(false);
  });

  it('rejects a payload using the old {next} field name', () => {
    const result = updateOrganizationStatusSchema.safeParse({ next: 'SUSPENDED' });

    expect(result.success).toBe(false);
  });
});
