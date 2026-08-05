import { User } from '../../../../../src/modules/identity-access/domain/model/aggregates/User.js';
import { createUserId } from '../../../../../src/modules/identity-access/domain/model/value-objects/UserId.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createEmail } from '../../../../../src/modules/identity-access/domain/model/value-objects/Email.js';
import { createPasswordCredential } from '../../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createTransitionActor } from '../../../../../src/modules/identity-access/domain/model/value-objects/TransitionActor.js';
import { IdentityAccessError } from '../../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-02T00:00:00.000Z'));
const CREDENTIAL = createPasswordCredential('hash-value', 'salt-value');

function buildUser(): User {
  return User.create({
    id: createUserId('user-1'),
    organizationId: createOrganizationId('org-1'),
    email: createEmail('alice@example.com'),
    credential: CREDENTIAL,
    firstName: 'Alice',
    lastName: 'Smith',
    now: NOW,
  });
}

describe('User.create', () => {
  it('starts a new user ACTIVE with matching created/updated timestamps', () => {
    const user = buildUser();

    expect(user.status).toBe('ACTIVE');
    expect(user.email).toBe('alice@example.com');
    expect(user.firstName).toBe('Alice');
    expect(user.lastName).toBe('Smith');
    expect(user.avatarUrl).toBeNull();
    expect(user.isPlatformAdmin).toBe(false);
    expect(user.createdAt).toBe(NOW);
    expect(user.updatedAt).toBe(NOW);
  });

  it('defaults isPlatformAdmin to false when not provided', () => {
    const user = buildUser();

    expect(user.isPlatformAdmin).toBe(false);
  });

  it('carries isPlatformAdmin=true when explicitly provisioned', () => {
    const user = User.create({
      id: createUserId('user-1'),
      organizationId: createOrganizationId('org-1'),
      email: createEmail('alice@example.com'),
      credential: CREDENTIAL,
      firstName: 'Alice',
      lastName: 'Smith',
      isPlatformAdmin: true,
      now: NOW,
    });

    expect(user.isPlatformAdmin).toBe(true);
  });

  it.each(['firstName', 'lastName'] as const)('rejects an empty %s as an invariant violation', (field) => {
    expect(() =>
      User.create({
        id: createUserId('user-1'),
        organizationId: createOrganizationId('org-1'),
        email: createEmail('alice@example.com'),
        credential: CREDENTIAL,
        firstName: 'Alice',
        lastName: 'Smith',
        [field]: '   ',
        now: NOW,
      }),
    ).toThrow(IdentityAccessError);
  });

  it('rejects a blank avatarUrl as an invariant violation', () => {
    expect(() =>
      User.create({
        id: createUserId('user-1'),
        organizationId: createOrganizationId('org-1'),
        email: createEmail('alice@example.com'),
        credential: CREDENTIAL,
        firstName: 'Alice',
        lastName: 'Smith',
        avatarUrl: '   ',
        now: NOW,
      }),
    ).toThrow(IdentityAccessError);
  });

  it('allows avatarUrl to be omitted (null), only rejects present-but-blank', () => {
    expect(() => buildUser()).not.toThrow();
  });
});

describe('User.rehydrate', () => {
  it('reconstructs a user from stored props without re-validating business rules', () => {
    const user = User.rehydrate({
      id: createUserId('user-1'),
      organizationId: createOrganizationId('org-1'),
      email: createEmail('alice@example.com'),
      credential: CREDENTIAL,
      firstName: 'Alice',
      lastName: 'Smith',
      avatarUrl: 'https://example.com/a.png',
      status: 'SUSPENDED',
      isPlatformAdmin: false,
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(user.status).toBe('SUSPENDED');
    expect(user.avatarUrl).toBe('https://example.com/a.png');
    expect(user.updatedAt).toBe(LATER);
  });
});

describe('User#patchIdentity', () => {
  it('returns a new instance with only the given fields changed', () => {
    const user = buildUser();

    const patched = user.patchIdentity(
      { firstName: 'Alicia', avatarUrl: 'https://example.com/a.png' },
      LATER,
    );

    expect(patched).not.toBe(user);
    expect(patched.firstName).toBe('Alicia');
    expect(patched.avatarUrl).toBe('https://example.com/a.png');
    expect(patched.lastName).toBe('Smith');
    expect(patched.updatedAt).toBe(LATER);
    expect(user.firstName).toBe('Alice');
  });

  it('updates the email when a new validated Email is given', () => {
    const user = buildUser();

    const patched = user.patchIdentity({ email: createEmail('alicia@example.com') }, LATER);

    expect(patched.email).toBe('alicia@example.com');
  });

  it.each(['firstName', 'lastName'] as const)('rejects patching %s to an empty string', (field) => {
    const user = buildUser();

    expect(() => user.patchIdentity({ [field]: '' }, LATER)).toThrow(IdentityAccessError);
  });

  it('rejects patching avatarUrl to a blank string', () => {
    const user = buildUser();

    expect(() => user.patchIdentity({ avatarUrl: '  ' }, LATER)).toThrow(IdentityAccessError);
  });
});

describe('User#transitionTo', () => {
  it('delegates to StatusTransitionPolicy and returns a new instance on a valid transition', () => {
    const user = buildUser();

    const transitioned = user.transitionTo('SUSPENDED', createTransitionActor(false), LATER);

    expect(transitioned).not.toBe(user);
    expect(transitioned.status).toBe('SUSPENDED');
    expect(transitioned.updatedAt).toBe(LATER);
    expect(user.status).toBe('ACTIVE');
  });

  it('rejects an invalid transition, leaving the original instance untouched', () => {
    const user = buildUser();

    expect(() => user.transitionTo('ACTIVE', createTransitionActor(true), LATER)).toThrow(IdentityAccessError);
    expect(user.status).toBe('ACTIVE');
  });

  it('rejects an org-admin self-reactivating a DISABLED user in their own org', () => {
    const user = buildUser().transitionTo('DISABLED', createTransitionActor(true), LATER);

    expect(() => user.transitionTo('ACTIVE', createTransitionActor(false), LATER)).toThrow(IdentityAccessError);
  });

  it('allows a platform-admin to reactivate a DISABLED user', () => {
    const user = buildUser().transitionTo('DISABLED', createTransitionActor(true), LATER);

    const reactivated = user.transitionTo('ACTIVE', createTransitionActor(true), LATER);

    expect(reactivated.status).toBe('ACTIVE');
  });
});
