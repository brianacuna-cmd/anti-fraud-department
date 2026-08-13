import { oid } from '../../../../support/oid.js';
import { Session } from '../../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createFamilyId } from '../../../../../src/modules/identity-access/domain/model/value-objects/FamilyId.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

describe('Session.create', () => {
  it('creates a USER-tier session with a full refresh pair', () => {
    const session = Session.create({
      id: createSessionId(oid('session-1')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      actorType: 'USER',
      tokenHash: 'token-hash',
      refreshTokenHash: 'refresh-hash',
      expiresAt: NOW,
      refreshExpiresAt: LATER,
      familyId: createFamilyId(oid('family-1')),
      familyExpiresAt: LATER,
      now: NOW,
    });

    expect(session.id).toBe(oid('session-1'));
    expect(session.userId).toBe(oid('user-1'));
    expect(session.organizationId).toBe(oid('org-1'));
    expect(session.actorType).toBe('USER');
    expect(session.refreshTokenHash).toBe('refresh-hash');
    expect(session.refreshExpiresAt).toBe(LATER);
    expect(session.rotatedAt).toBeNull();
    expect(session.rotatedFromSessionId).toBeNull();
    expect(session.deletedAt).toBeNull();
    expect(session.isRevoked).toBe(false);
    expect(session.createdAt).toBe(NOW);
    expect(session.updatedAt).toBe(NOW);
  });

  it('accepts a null refresh pair for a refresh-less tier (design D38 — PLATFORM_ADMIN)', () => {
    const session = Session.create({
      id: createSessionId(oid('session-2')),
      userId: oid('admin-1'),
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
      tokenHash: 'token-hash-2',
      refreshTokenHash: null,
      expiresAt: NOW,
      refreshExpiresAt: null,
      familyId: createFamilyId(oid('family-2')),
      familyExpiresAt: NOW,
      now: NOW,
    });

    expect(session.refreshTokenHash).toBeNull();
    expect(session.refreshExpiresAt).toBeNull();
    expect(session.organizationId).toBeNull();
  });

  it('creates an ORGANIZATION-tier session with a null userId (design D14)', () => {
    const session = Session.create({
      id: createSessionId(oid('session-3')),
      userId: null,
      organizationId: createOrganizationId(oid('org-1')),
      actorType: 'ORGANIZATION',
      tokenHash: 'token-hash-3',
      refreshTokenHash: 'refresh-hash-3',
      expiresAt: NOW,
      refreshExpiresAt: LATER,
      familyId: createFamilyId(oid('family-3')),
      familyExpiresAt: LATER,
      now: NOW,
    });

    expect(session.userId).toBeNull();
    expect(session.actorType).toBe('ORGANIZATION');
  });

  it('accepts an explicit rotatedFromSessionId for a rotation successor', () => {
    const session = Session.create({
      id: createSessionId(oid('session-4')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      actorType: 'USER',
      tokenHash: 'token-hash-4',
      refreshTokenHash: 'refresh-hash-4',
      expiresAt: NOW,
      refreshExpiresAt: LATER,
      familyId: createFamilyId(oid('family-1')),
      familyExpiresAt: LATER,
      rotatedFromSessionId: createSessionId(oid('session-1')),
      now: NOW,
    });

    expect(session.rotatedFromSessionId).toBe(oid('session-1'));
  });
});

describe('Session.rehydrate', () => {
  it('reconstructs a session from stored props without re-validating', () => {
    const session = Session.rehydrate({
      id: createSessionId(oid('session-1')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      actorType: 'USER',
      tokenHash: 'token-hash',
      refreshTokenHash: 'refresh-hash',
      expiresAt: NOW,
      refreshExpiresAt: LATER,
      familyId: createFamilyId(oid('family-1')),
      familyExpiresAt: LATER,
      rotatedAt: NOW,
      rotatedFromSessionId: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    expect(session.rotatedAt).toBe(NOW);
  });

  it('is revoked when deletedAt is set — the sole revocation signal (design D14)', () => {
    const session = Session.rehydrate({
      id: createSessionId(oid('session-1')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      actorType: 'USER',
      tokenHash: 'token-hash',
      refreshTokenHash: 'refresh-hash',
      expiresAt: NOW,
      refreshExpiresAt: LATER,
      familyId: createFamilyId(oid('family-1')),
      familyExpiresAt: LATER,
      rotatedAt: null,
      rotatedFromSessionId: null,
      createdAt: NOW,
      updatedAt: LATER,
      deletedAt: LATER,
    });

    expect(session.isRevoked).toBe(true);
    expect(session.deletedAt).toBe(LATER);
  });
});
