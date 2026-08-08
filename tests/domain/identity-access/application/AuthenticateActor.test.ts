import { createAuthenticateActorUseCase } from '../../../../src/modules/identity-access/application/auth/AuthenticateActor.js';
import { InMemoryActorCredentialGateway } from '../../../helpers/identity-access/InMemoryActorCredentialGateway.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FakePasswordHasher } from '../../../helpers/identity-access/FakePasswordHasher.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';
import { createPasswordCredential } from '../../../../src/modules/identity-access/domain/model/value-objects/PasswordCredential.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { IdentityAccessError } from '../../../../src/modules/identity-access/domain/errors/IdentityAccessError.js';
import type { ActorCredentialRecord } from '../../../../src/modules/identity-access/domain/ports/ActorCredentialGateway.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const DUMMY_CREDENTIAL = createPasswordCredential('hashed:dummy-password');

const ORG_ID = createOrganizationId('org-1');
const USER_RECORD: ActorCredentialRecord = {
  actorId: 'user-1',
  actorType: 'USER',
  organizationId: ORG_ID,
  credential: createPasswordCredential('hashed:correct-password'),
  lockout: { loginAttempts: 0, blockedUntil: null },
  status: 'ACTIVE',
  mfa: { enabled: false, secret: null },
};

function buildUseCase() {
  const gateway = new InMemoryActorCredentialGateway();
  const passwordHasher = new FakePasswordHasher();
  const auditRecorder = new InMemoryAuditRecorder();
  const authenticateActor = createAuthenticateActorUseCase({
    gateway,
    passwordHasher,
    clock: new FixedClock(NOW),
    dummyCredential: DUMMY_CREDENTIAL,
    actorType: 'USER',
    auditRecorder,
  });
  return { authenticateActor, gateway, passwordHasher, auditRecorder };
}

async function expectIdentityAccessError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(IdentityAccessError);
  expect((caught as InstanceType<typeof IdentityAccessError>).code).toBe(code);
}

describe('createAuthenticateActorUseCase', () => {
  it('authenticates on correct credentials and resets lockout via registerLoginSuccess', async () => {
    const { authenticateActor, gateway } = buildUseCase();
    gateway.seed('alice@example.com', USER_RECORD, 'acme');

    const result = await authenticateActor({
      email: 'alice@example.com',
      password: 'correct-password',
      organizationSlug: 'acme',
    });

    expect(result).toEqual({
      actorId: 'user-1',
      actorType: 'USER',
      organizationId: ORG_ID,
      mfa: { enabled: false },
    });
    expect(gateway.registeredSuccesses).toEqual(['user-1']);
  });

  it('propagates mfa.enabled=true from the resolved actor record (two-step-login PR2)', async () => {
    const { authenticateActor, gateway } = buildUseCase();
    gateway.seed(
      'alice@example.com',
      { ...USER_RECORD, mfa: { enabled: true, secret: 'encrypted-secret' } },
      'acme',
    );

    const result = await authenticateActor({
      email: 'alice@example.com',
      password: 'correct-password',
      organizationSlug: 'acme',
    });

    expect(result.mfa).toEqual({ enabled: true });
  });

  it('rejects an unknown email with INVALID_CREDENTIALS, running a dummy verify for timing safety (design D24)', async () => {
    const { authenticateActor, passwordHasher } = buildUseCase();

    await expectIdentityAccessError(
      authenticateActor({ email: 'nobody@example.com', password: 'whatever', organizationSlug: 'acme' }),
      'INVALID_CREDENTIALS',
    );
    expect(passwordHasher.verifyCallCount).toBe(1);
  });

  it('rejects a wrong password with the SAME INVALID_CREDENTIALS shape as an unknown email', async () => {
    const { authenticateActor, gateway } = buildUseCase();
    gateway.seed('alice@example.com', USER_RECORD, 'acme');

    await expectIdentityAccessError(
      authenticateActor({ email: 'alice@example.com', password: 'wrong-password', organizationSlug: 'acme' }),
      'INVALID_CREDENTIALS',
    );
  });

  it('increments lockout on a wrong password without locking below the 3rd failure', async () => {
    const { authenticateActor, gateway } = buildUseCase();
    gateway.seed('alice@example.com', USER_RECORD, 'acme');

    await expectIdentityAccessError(
      authenticateActor({ email: 'alice@example.com', password: 'wrong-password', organizationSlug: 'acme' }),
      'INVALID_CREDENTIALS',
    );

    expect(gateway.registeredFailures).toEqual([{ actorId: 'user-1', lockout: { loginAttempts: 1, blockedUntil: null } }]);
  });

  it('locks the account with ACCOUNT_LOCKED on the 3rd consecutive failure (design D18)', async () => {
    const { authenticateActor, gateway } = buildUseCase();
    gateway.seed('alice@example.com', { ...USER_RECORD, lockout: { loginAttempts: 2, blockedUntil: null } }, 'acme');

    await expectIdentityAccessError(
      authenticateActor({ email: 'alice@example.com', password: 'wrong-password', organizationSlug: 'acme' }),
      'ACCOUNT_LOCKED',
    );

    expect(gateway.registeredFailures[0]?.lockout.loginAttempts).toBe(3);
    expect(gateway.registeredFailures[0]?.lockout.blockedUntil).not.toBeNull();
  });

  it('a blocked account fails ACCOUNT_LOCKED WITHOUT calling verify (skips the password check)', async () => {
    const { authenticateActor, gateway, passwordHasher } = buildUseCase();
    const blockedUntil = fromDate(new Date('2026-01-01T01:00:00.000Z'));
    gateway.seed(
      'alice@example.com',
      { ...USER_RECORD, lockout: { loginAttempts: 3, blockedUntil } },
      'acme',
    );

    await expectIdentityAccessError(
      authenticateActor({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' }),
      'ACCOUNT_LOCKED',
    );
    expect(passwordHasher.verifyCallCount).toBe(0);
  });

  it('an EXPIRED lock still runs the password check (isLocked reads it as unlocked)', async () => {
    const { authenticateActor, gateway } = buildUseCase();
    const expiredBlockedUntil = fromDate(new Date('2025-12-31T00:00:00.000Z'));
    gateway.seed(
      'alice@example.com',
      { ...USER_RECORD, lockout: { loginAttempts: 3, blockedUntil: expiredBlockedUntil } },
      'acme',
    );

    const result = await authenticateActor({
      email: 'alice@example.com',
      password: 'correct-password',
      organizationSlug: 'acme',
    });

    expect(result.actorId).toBe('user-1');
  });

  it('emits a LOGIN audit event on success (best-effort, no transaction)', async () => {
    const { authenticateActor, gateway, auditRecorder } = buildUseCase();
    gateway.seed('alice@example.com', USER_RECORD, 'acme');

    await authenticateActor({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeUndefined();
    expect(calls[0].event.action).toBe('LOGIN');
    expect(calls[0].event.actorId).toBe('user-1');
    expect(calls[0].event.actorType).toBe('USER');
  });

  it('emits a LOGIN_FAILED event with a null actorId and the attempted email for an unknown login', async () => {
    const { authenticateActor, auditRecorder } = buildUseCase();

    await expectIdentityAccessError(
      authenticateActor({ email: 'nobody@example.com', password: 'whatever', organizationSlug: 'acme' }),
      'INVALID_CREDENTIALS',
    );

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('LOGIN_FAILED');
    expect(calls[0].event.actorId).toBeNull();
    expect(calls[0].event.organizationId).toBeNull();
    expect(calls[0].event.actorType).toBe('USER');
    expect(calls[0].event.detail).toEqual({ reason: 'INVALID_CREDENTIALS', email: 'nobody@example.com' });
  });

  it('emits a LOGIN_FAILED event for a wrong password against a known actor', async () => {
    const { authenticateActor, gateway, auditRecorder } = buildUseCase();
    gateway.seed('alice@example.com', USER_RECORD, 'acme');

    await expectIdentityAccessError(
      authenticateActor({ email: 'alice@example.com', password: 'wrong-password', organizationSlug: 'acme' }),
      'INVALID_CREDENTIALS',
    );

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('LOGIN_FAILED');
    expect(calls[0].event.actorId).toBe('user-1');
    expect(calls[0].event.detail).toEqual({ reason: 'INVALID_CREDENTIALS', email: 'alice@example.com' });
  });

  it('emits a LOGIN_FAILED event with ACCOUNT_LOCKED reason for a blocked account', async () => {
    const { authenticateActor, gateway, auditRecorder } = buildUseCase();
    const blockedUntil = fromDate(new Date('2026-01-01T01:00:00.000Z'));
    gateway.seed('alice@example.com', { ...USER_RECORD, lockout: { loginAttempts: 3, blockedUntil } }, 'acme');

    await expectIdentityAccessError(
      authenticateActor({ email: 'alice@example.com', password: 'correct-password', organizationSlug: 'acme' }),
      'ACCOUNT_LOCKED',
    );

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].event.action).toBe('LOGIN_FAILED');
    expect(calls[0].event.detail).toMatchObject({ reason: 'ACCOUNT_LOCKED' });
  });

  it('still authenticates when the audit write throws (best-effort emission)', async () => {
    const gateway = new InMemoryActorCredentialGateway();
    gateway.seed('alice@example.com', USER_RECORD, 'acme');
    const authenticateActor = createAuthenticateActorUseCase({
      gateway,
      passwordHasher: new FakePasswordHasher(),
      clock: new FixedClock(NOW),
      dummyCredential: DUMMY_CREDENTIAL,
      actorType: 'USER',
      auditRecorder: {
        record: async () => {
          throw new Error('audit backend down');
        },
      },
    });

    const result = await authenticateActor({
      email: 'alice@example.com',
      password: 'correct-password',
      organizationSlug: 'acme',
    });

    expect(result.actorId).toBe('user-1');
  });
});
