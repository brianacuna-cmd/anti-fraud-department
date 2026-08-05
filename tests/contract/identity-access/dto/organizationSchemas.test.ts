import {
  createOrganizationSchema,
  patchOrganizationSchema,
  transitionOrganizationSchema,
} from '../../../../src/modules/identity-access/infrastructure/adapters/inbound/http/dto/organizationSchemas.js';

const VALID_ADMIN_FIELDS = {
  adminEmail: 'admin@acme.com',
  adminPassword: 'super-secret',
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
  it('accepts name, domain, and logoUrl', () => {
    const result = patchOrganizationSchema.safeParse({
      name: 'Acme Corp',
      domain: 'acme.com',
      logoUrl: 'https://acme.com/logo.png',
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
});

describe('transitionOrganizationSchema', () => {
  it.each(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISABLED'])('accepts the valid status %s', (next) => {
    const result = transitionOrganizationSchema.safeParse({ next });

    expect(result.success).toBe(true);
  });

  it('rejects a status outside the closed set', () => {
    const result = transitionOrganizationSchema.safeParse({ next: 'BORRADO' });

    expect(result.success).toBe(false);
  });
});
