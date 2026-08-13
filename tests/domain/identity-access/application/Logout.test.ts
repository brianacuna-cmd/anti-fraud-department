import { oid } from '../../../support/oid.js';
import { createLogoutUseCase } from '../../../../src/modules/identity-access/application/auth/Logout.js';
import { InMemorySessionRepository } from '../../../helpers/identity-access/InMemorySessionRepository.js';
import { InMemoryAuditRecorder } from '../../../helpers/identity-access/InMemoryAuditRecorder.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { Session } from '../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createAuthContext } from '../../../../src/shared/kernel/AuthContext.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

function buildSession(id: string): Session {
  return Session.create({
    id: createSessionId(id),
    userId: oid('user-1'),
    organizationId: createOrganizationId(oid('org-1')),
    actorType: 'USER',
    tokenHash: `token-hash-${id}`,
    refreshTokenHash: `refresh-hash-${id}`,
    expiresAt: LATER,
    refreshExpiresAt: LATER,
    familyId: createFamilyId(oid('family-1')),
    familyExpiresAt: LATER,
    now: NOW,
  });
}

function buildUseCase() {
  const sessions = new InMemorySessionRepository();
  const auditRecorder = new InMemoryAuditRecorder();
  const logout = createLogoutUseCase({ sessions, clock: new FixedClock(LATER), auditRecorder });
  return { logout, sessions, auditRecorder };
}

describe('createLogoutUseCase', () => {
  it('sets deletedAt on the current session (design authentication-session spec: "Logout and Session Validation")', async () => {
    const { logout, sessions } = buildUseCase();
    await sessions.save(buildSession(oid('session-1')));
    const auth = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), sessionId: oid('session-1') });

    await logout({ auth });

    const revoked = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    expect(revoked?.deletedAt).toBe(LATER);
  });

  it('does not touch other sessions', async () => {
    const { logout, sessions } = buildUseCase();
    await sessions.save(buildSession(oid('session-1')));
    await sessions.save(buildSession(oid('session-2')));
    const auth = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), sessionId: oid('session-1') });

    await logout({ auth });

    const other = await sessions.findByTokenHash(`token-hash-${oid('session-2')}`);
    expect(other?.deletedAt).toBeNull();
  });

  it('is a no-op when AuthContext carries no sessionId (e.g. trusted-header dev mode)', async () => {
    const { logout, sessions } = buildUseCase();
    await sessions.save(buildSession(oid('session-1')));
    const auth = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

    await expect(logout({ auth })).resolves.toBeUndefined();

    const untouched = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    expect(untouched?.deletedAt).toBeNull();
  });

  it('emits a LOGOUT audit event when a session is revoked', async () => {
    const { logout, sessions, auditRecorder } = buildUseCase();
    await sessions.save(buildSession(oid('session-1')));
    const auth = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1'), sessionId: oid('session-1') });

    await logout({ auth });

    const calls = auditRecorder.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].tx).toBeUndefined();
    expect(calls[0].event.action).toBe('LOGOUT');
    expect(calls[0].event.actorId).toBe(oid('user-1'));
    expect(calls[0].event.resourceId).toBe(oid('session-1'));
  });

  it('emits no audit event on the no-op path (no sessionId)', async () => {
    const { logout, sessions, auditRecorder } = buildUseCase();
    await sessions.save(buildSession(oid('session-1')));
    const auth = createAuthContext({ userId: oid('user-1'), organizationId: oid('org-1') });

    await logout({ auth });

    expect(auditRecorder.all()).toHaveLength(0);
  });

  it('ORGANIZATION actor logout revokes ALL sessions for that organization (behavior change)', async () => {
    const { logout, sessions } = buildUseCase();
    await sessions.save(
      Session.create({
        id: createSessionId(oid('org-session-1')),
        userId: null,
        organizationId: createOrganizationId(oid('org-1')),
        actorType: 'ORGANIZATION',
        tokenHash: 'token-hash-org-session-1',
        refreshTokenHash: 'refresh-hash-org-session-1',
        expiresAt: LATER,
        refreshExpiresAt: LATER,
        familyId: createFamilyId(oid('family-org-1')),
        familyExpiresAt: LATER,
        now: NOW,
      }),
    );
    await sessions.save(
      Session.create({
        id: createSessionId(oid('org-session-2')),
        userId: null,
        organizationId: createOrganizationId(oid('org-1')),
        actorType: 'ORGANIZATION',
        tokenHash: 'token-hash-org-session-2',
        refreshTokenHash: 'refresh-hash-org-session-2',
        expiresAt: LATER,
        refreshExpiresAt: LATER,
        familyId: createFamilyId(oid('family-org-1')),
        familyExpiresAt: LATER,
        now: NOW,
      }),
    );
    const auth = createAuthContext({
      userId: oid('org-1'),
      organizationId: oid('org-1'),
      actorType: 'ORGANIZATION',
      sessionId: oid('org-session-1'),
    });

    await logout({ auth });

    const first = await sessions.findByTokenHash('token-hash-org-session-1');
    const second = await sessions.findByTokenHash('token-hash-org-session-2');
    expect(first?.deletedAt).toBe(LATER);
    expect(second?.deletedAt).toBe(LATER);
  });

  it('USER actor logout still revokes only the current session (regression)', async () => {
    const { logout, sessions } = buildUseCase();
    await sessions.save(buildSession(oid('session-1')));
    await sessions.save(buildSession(oid('session-2')));
    const auth = createAuthContext({
      userId: oid('user-1'),
      organizationId: oid('org-1'),
      actorType: 'USER',
      sessionId: oid('session-1'),
    });

    await logout({ auth });

    const revoked = await sessions.findByTokenHash(`token-hash-${oid('session-1')}`);
    const other = await sessions.findByTokenHash(`token-hash-${oid('session-2')}`);
    expect(revoked?.deletedAt).toBe(LATER);
    expect(other?.deletedAt).toBeNull();
  });
});
