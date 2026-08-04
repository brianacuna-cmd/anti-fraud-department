import { Organization } from '../../../../../src/modules/identity-access/domain/model/aggregates/Organization.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createSlug } from '../../../../../src/modules/identity-access/domain/model/value-objects/Slug.js';
import { createTransitionActor } from '../../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));

function buildOrganization(): Organization {
  return Organization.create({
    id: createOrganizationId('org-1'),
    name: 'Acme Corp',
    slug: createSlug('acme-corp'),
    now: NOW,
  });
}

describe('Organization.create', () => {
  it('starts a new organization ACTIVO with matching created/updated timestamps', () => {
    const organization = buildOrganization();

    expect(organization.status).toBe('ACTIVO');
    expect(organization.name).toBe('Acme Corp');
    expect(organization.slug).toBe('acme-corp');
    expect(organization.domain).toBeNull();
    expect(organization.logoUrl).toBeNull();
    expect(organization.createdAt).toBe(NOW);
    expect(organization.updatedAt).toBe(NOW);
  });

  it('rejects an empty name as an invariant violation', () => {
    expect(() =>
      Organization.create({
        id: createOrganizationId('org-1'),
        name: '   ',
        slug: createSlug('acme-corp'),
        now: NOW,
      }),
    ).toThrow(IdentityAccessError);
  });

  it.each(['domain', 'logoUrl'] as const)('rejects a blank %s as an invariant violation', (field) => {
    expect(() =>
      Organization.create({
        id: createOrganizationId('org-1'),
        name: 'Acme Corp',
        slug: createSlug('acme-corp'),
        [field]: '   ',
        now: NOW,
      }),
    ).toThrow(IdentityAccessError);
  });

  it('allows domain/logoUrl to be omitted (null), only rejects present-but-blank', () => {
    expect(() => buildOrganization()).not.toThrow();
  });
});

describe('Organization.rehydrate', () => {
  it('reconstructs an organization from stored props without re-validating business rules', () => {
    const organization = Organization.rehydrate({
      id: createOrganizationId('org-1'),
      name: 'Acme Corp',
      slug: createSlug('acme-corp'),
      domain: 'acme.com',
      status: 'SUSPENDIDO',
      logoUrl: 'https://acme.com/logo.png',
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(organization.status).toBe('SUSPENDIDO');
    expect(organization.domain).toBe('acme.com');
    expect(organization.updatedAt).toBe(LATER);
  });
});

describe('Organization#patchIdentity', () => {
  it('returns a new instance with only the given fields changed, slug untouched', () => {
    const organization = buildOrganization();

    const patched = organization.patchIdentity({ name: 'Acme Corp Inc', logoUrl: 'https://acme.com/logo.png' }, LATER);

    expect(patched).not.toBe(organization);
    expect(patched.name).toBe('Acme Corp Inc');
    expect(patched.logoUrl).toBe('https://acme.com/logo.png');
    expect(patched.slug).toBe('acme-corp');
    expect(patched.updatedAt).toBe(LATER);
    expect(organization.name).toBe('Acme Corp');
  });

  it('rejects patching the name to an empty string as an invariant violation', () => {
    const organization = buildOrganization();

    expect(() => organization.patchIdentity({ name: '' }, LATER)).toThrow(IdentityAccessError);
  });

  it.each(['domain', 'logoUrl'] as const)('rejects patching %s to a blank string', (field) => {
    const organization = buildOrganization();

    expect(() => organization.patchIdentity({ [field]: '  ' }, LATER)).toThrow(IdentityAccessError);
  });
});

describe('Organization#transitionTo', () => {
  it('delegates to StatusTransitionPolicy and returns a new instance on a valid transition', () => {
    const organization = buildOrganization();

    const transitioned = organization.transitionTo('SUSPENDIDO', createTransitionActor(true), LATER);

    expect(transitioned).not.toBe(organization);
    expect(transitioned.status).toBe('SUSPENDIDO');
    expect(transitioned.updatedAt).toBe(LATER);
    expect(organization.status).toBe('ACTIVO');
  });

  it('rejects an invalid transition, leaving the original instance untouched', () => {
    const organization = buildOrganization();

    expect(() => organization.transitionTo('ACTIVO', createTransitionActor(true), LATER)).toThrow(
      IdentityAccessError,
    );
    expect(organization.status).toBe('ACTIVO');
  });

  it('rejects a non-platform-admin reactivating a DESHABILITADO organization', () => {
    const organization = buildOrganization().transitionTo('DESHABILITADO', createTransitionActor(true), LATER);

    expect(() =>
      organization.transitionTo('ACTIVO', createTransitionActor(false), LATER),
    ).toThrow(IdentityAccessError);
  });
});
