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
const CREDENTIAL = createPasswordCredential('hash-value');

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

  it('defaults middleName to null when not provided', () => {
    const user = buildUser();

    expect(user.middleName).toBeNull();
  });

  it('accepts a provided middleName', () => {
    const user = User.create({
      id: createUserId('user-1'),
      organizationId: createOrganizationId('org-1'),
      email: createEmail('alice@example.com'),
      credential: CREDENTIAL,
      firstName: 'Alice',
      lastName: 'Smith',
      middleName: 'Marie',
      now: NOW,
    });

    expect(user.middleName).toBe('Marie');
  });

  it('rejects a blank middleName as an invariant violation', () => {
    expect(() =>
      User.create({
        id: createUserId('user-1'),
        organizationId: createOrganizationId('org-1'),
        email: createEmail('alice@example.com'),
        credential: CREDENTIAL,
        firstName: 'Alice',
        lastName: 'Smith',
        middleName: '   ',
        now: NOW,
      }),
    ).toThrow(IdentityAccessError);
  });

  it('defaults resetToken to null (persistence/domain-only, design A11)', () => {
    const user = buildUser();

    expect(user.resetToken).toBeNull();
  });

  it('defaults mfa to a disabled, secret-less, empty-recovery-codes shape (persistence/domain-only, design A11)', () => {
    const user = buildUser();

    expect(user.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
  });

  it('defaults lockout to zero failed attempts, never blocked (design D18)', () => {
    const user = buildUser();

    expect(user.lockout).toEqual({ loginAttempts: 0, blockedUntil: null });
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
      middleName: 'Marie',
      lastName: 'Smith',
      avatarUrl: 'https://example.com/a.png',
      status: 'SUSPENDED',
      isPlatformAdmin: false,
      resetToken: { hash: 'reset-hash', expiresAt: LATER },
      mfa: { secret: 'otp-secret', enabled: true, recoveryCodes: ['code-1'] },
      lockout: { loginAttempts: 2, blockedUntil: null },
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(user.status).toBe('SUSPENDED');
    expect(user.avatarUrl).toBe('https://example.com/a.png');
    expect(user.middleName).toBe('Marie');
    expect(user.resetToken).toEqual({ hash: 'reset-hash', expiresAt: LATER });
    expect(user.mfa).toEqual({ secret: 'otp-secret', enabled: true, recoveryCodes: ['code-1'] });
    expect(user.lockout).toEqual({ loginAttempts: 2, blockedUntil: null });
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

  it('accepts patching middleName to a string or null (design A12)', () => {
    const user = buildUser();

    const patchedToValue = user.patchIdentity({ middleName: 'Marie' }, LATER);
    expect(patchedToValue.middleName).toBe('Marie');

    const patchedBackToNull = patchedToValue.patchIdentity({ middleName: null }, LATER);
    expect(patchedBackToNull.middleName).toBeNull();
  });

  it('leaves middleName untouched when omitted from the patch', () => {
    const user = buildUser();

    const patched = user.patchIdentity({ firstName: 'Alicia' }, LATER);

    expect(patched.middleName).toBeNull();
  });

  it('rejects patching middleName to a blank string', () => {
    const user = buildUser();

    expect(() => user.patchIdentity({ middleName: '  ' }, LATER)).toThrow(IdentityAccessError);
  });

  it('leaves resetToken and mfa untouched by patchIdentity (persistence/domain-only, design A11)', () => {
    const user = buildUser();

    const patched = user.patchIdentity({ firstName: 'Alicia' }, LATER);

    expect(patched.resetToken).toBeNull();
    expect(patched.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
  });
});

describe('User#withLockout', () => {
  it('returns a new instance with only lockout/updatedAt changed (design D18)', () => {
    const user = buildUser();

    const locked = user.withLockout({ loginAttempts: 3, blockedUntil: LATER }, LATER);

    expect(locked).not.toBe(user);
    expect(locked.lockout).toEqual({ loginAttempts: 3, blockedUntil: LATER });
    expect(locked.updatedAt).toBe(LATER);
    expect(locked.firstName).toBe('Alice');
    expect(user.lockout).toEqual({ loginAttempts: 0, blockedUntil: null });
  });
});

describe('User#startMfaEnrollment', () => {
  it('stores the encrypted secret with enabled=false', () => {
    const user = buildUser();

    const enrolling = user.startMfaEnrollment('encrypted-secret', LATER);

    expect(enrolling).not.toBe(user);
    expect(enrolling.mfa).toEqual({ secret: 'encrypted-secret', enabled: false, recoveryCodes: [] });
    expect(enrolling.updatedAt).toBe(LATER);
    expect(user.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
  });

  it('overwrites a previously pending secret when enrollment is restarted', () => {
    const user = buildUser().startMfaEnrollment('first-secret', NOW);

    const restarted = user.startMfaEnrollment('second-secret', LATER);

    expect(restarted.mfa).toEqual({ secret: 'second-secret', enabled: false, recoveryCodes: [] });
  });
});

describe('User#confirmMfaEnrollment', () => {
  it('enables MFA when a secret is pending', () => {
    const user = buildUser().startMfaEnrollment('encrypted-secret', NOW);

    const confirmed = user.confirmMfaEnrollment(LATER);

    expect(confirmed).not.toBe(user);
    expect(confirmed.mfa).toEqual({ secret: 'encrypted-secret', enabled: true, recoveryCodes: [] });
    expect(confirmed.updatedAt).toBe(LATER);
  });

  it('rejects confirmation when no secret is pending', () => {
    const user = buildUser();

    expect(() => user.confirmMfaEnrollment(LATER)).toThrow(IdentityAccessError);
  });

  it('rejects confirmation when MFA is already enabled', () => {
    const user = buildUser().startMfaEnrollment('encrypted-secret', NOW).confirmMfaEnrollment(NOW);

    expect(() => user.confirmMfaEnrollment(LATER)).toThrow(IdentityAccessError);
  });
});

describe('User#disableMfa', () => {
  it('clears the secret and disables MFA', () => {
    const user = buildUser().startMfaEnrollment('encrypted-secret', NOW).confirmMfaEnrollment(NOW);

    const disabled = user.disableMfa(LATER);

    expect(disabled).not.toBe(user);
    expect(disabled.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
    expect(disabled.updatedAt).toBe(LATER);
  });

  it('is idempotent when MFA is already disabled', () => {
    const user = buildUser();

    const disabled = user.disableMfa(LATER);

    expect(disabled.mfa).toEqual({ secret: null, enabled: false, recoveryCodes: [] });
  });
});

describe('User#changeCredential', () => {
  it('replaces the credential and bumps updatedAt, leaving the original instance untouched', () => {
    const user = buildUser();
    const newCredential = createPasswordCredential('new-hash-value');

    const changed = user.changeCredential(newCredential, LATER);

    expect(changed).not.toBe(user);
    expect(changed.credential).toEqual(newCredential);
    expect(changed.updatedAt).toBe(LATER);
    expect(user.credential).toEqual(CREDENTIAL);
    expect(user.updatedAt).toBe(NOW);
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
