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
  it('starts a new organization ACTIVE with matching created/updated timestamps and no deletedAt', () => {
    const organization = buildOrganization();

    expect(organization.status).toBe('ACTIVE');
    expect(organization.name).toBe('Acme Corp');
    expect(organization.slug).toBe('acme-corp');
    expect(organization.domain).toBeNull();
    expect(organization.logoUrl).toBeNull();
    expect(organization.createdAt).toBe(NOW);
    expect(organization.updatedAt).toBe(NOW);
    expect(organization.deletedAt).toBeNull();
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
      status: 'SUSPENDED',
      logoUrl: 'https://acme.com/logo.png',
      createdAt: NOW,
      updatedAt: LATER,
      deletedAt: null,
    });

    expect(organization.status).toBe('SUSPENDED');
    expect(organization.domain).toBe('acme.com');
    expect(organization.updatedAt).toBe(LATER);
    expect(organization.deletedAt).toBeNull();
  });

  it('reconstructs a CANCELLED organization with its stored deletedAt', () => {
    const organization = Organization.rehydrate({
      id: createOrganizationId('org-1'),
      name: 'Acme Corp',
      slug: createSlug('acme-corp'),
      domain: null,
      status: 'CANCELLED',
      logoUrl: null,
      createdAt: NOW,
      updatedAt: LATER,
      deletedAt: LATER,
    });

    expect(organization.status).toBe('CANCELLED');
    expect(organization.deletedAt).toBe(LATER);
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

    const transitioned = organization.transitionTo('SUSPENDED', createTransitionActor(true), LATER);

    expect(transitioned).not.toBe(organization);
    expect(transitioned.status).toBe('SUSPENDED');
    expect(transitioned.updatedAt).toBe(LATER);
    expect(transitioned.deletedAt).toBeNull();
    expect(organization.status).toBe('ACTIVE');
  });

  it('rejects an invalid (no-op) transition, leaving the original instance untouched', () => {
    const organization = buildOrganization();

    expect(() => organization.transitionTo('ACTIVE', createTransitionActor(true), LATER)).toThrow(
      IdentityAccessError,
    );
    expect(organization.status).toBe('ACTIVE');
  });

  it('sets deletedAt to the transition instant when transitioning to CANCELLED', () => {
    const organization = buildOrganization();

    const cancelled = organization.transitionTo('CANCELLED', createTransitionActor(true), LATER);

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.deletedAt).toBe(LATER);
    expect(organization.deletedAt).toBeNull();
  });

  it('rejects any transition out of CANCELLED, for any actor including a platform-admin — terminal by table alone', () => {
    const cancelled = buildOrganization().transitionTo('CANCELLED', createTransitionActor(true), LATER);

    expect(() => cancelled.transitionTo('ACTIVE', createTransitionActor(true), LATER)).toThrow(
      IdentityAccessError,
    );
    expect(() => cancelled.transitionTo('SUSPENDED', createTransitionActor(true), LATER)).toThrow(
      IdentityAccessError,
    );
  });

  it('allows a non-platform-admin actor to reactivate SUSPENDED -> ACTIVE — no gate on this edge (design D10)', () => {
    const suspended = buildOrganization().transitionTo('SUSPENDED', createTransitionActor(true), LATER);

    expect(() =>
      suspended.transitionTo('ACTIVE', createTransitionActor(false), LATER),
    ).not.toThrow();
  });
});
