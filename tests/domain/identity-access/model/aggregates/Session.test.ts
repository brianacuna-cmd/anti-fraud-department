import { oid } from '../../../../support/oid.js';
import { Session } from '../../../../../src/modules/identity-access/domain/model/aggregates/Session.js';
import { createSessionId } from '../../../../../src/modules/identity-access/domain/model/value-objects/SessionId.js';
import { createOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/OrganizationId.js';
import { createAdminOrganizationId } from '../../../../../src/modules/identity-access/domain/model/value-objects/AdminOrganizationId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));
const LATER = fromDate(new Date('2026-01-01T00:10:00.000Z'));

describe('Session.create', () => {
  it('creates a USER session from user_id (+ organization_id)', () => {
    const session = Session.create({
      id: createSessionId(oid('session-1')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      tokenHash: 'token-hash',
      expiresAt: NOW,
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      now: NOW,
    });

    expect(session.id).toBe(oid('session-1'));
    expect(session.userId).toBe(oid('user-1'));
    expect(session.organizationId).toBe(oid('org-1'));
    expect(session.adminOrganizationId).toBeNull();
    expect(session.actorType).toBe('USER');
    expect(session.ipAddress).toBe('127.0.0.1');
    expect(session.userAgent).toBe('jest');
    expect(session.deletedAt).toBeNull();
    expect(session.isRevoked).toBe(false);
    expect(session.createdAt).toBe(NOW);
  });

  it('creates a PLATFORM_ADMIN session from admin_organization_id', () => {
    const session = Session.create({
      id: createSessionId(oid('session-2')),
      adminOrganizationId: createAdminOrganizationId(oid('admin-1')),
      tokenHash: 'token-hash-2',
      expiresAt: NOW,
      now: NOW,
    });

    expect(session.actorType).toBe('PLATFORM_ADMIN');
    expect(session.adminOrganizationId).toBe(oid('admin-1'));
    expect(session.userId).toBeNull();
    expect(session.organizationId).toBeNull();
  });

  it('creates an ORGANIZATION session from organization_id only', () => {
    const session = Session.create({
      id: createSessionId(oid('session-3')),
      organizationId: createOrganizationId(oid('org-1')),
      tokenHash: 'token-hash-3',
      expiresAt: NOW,
      now: NOW,
    });

    expect(session.userId).toBeNull();
    expect(session.actorType).toBe('ORGANIZATION');
  });

  it('rejects a session with no principal FK', () => {
    expect(() =>
      Session.create({
        id: createSessionId(oid('session-4')),
        tokenHash: 'token-hash-4',
        expiresAt: NOW,
        now: NOW,
      }),
    ).toThrow(/userId, organizationId, or adminOrganizationId/);
  });
});

describe('Session.rehydrate', () => {
  it('reconstructs a session from stored props', () => {
    const session = Session.rehydrate({
      id: createSessionId(oid('session-1')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      adminOrganizationId: null,
      tokenHash: 'token-hash',
      expiresAt: NOW,
      ipAddress: null,
      userAgent: null,
      createdAt: NOW,
      deletedAt: null,
    });

    expect(session.actorType).toBe('USER');
    expect(session.createdAt).toBe(NOW);
  });

  it('is revoked when deletedAt is set', () => {
    const session = Session.rehydrate({
      id: createSessionId(oid('session-1')),
      userId: oid('user-1'),
      organizationId: createOrganizationId(oid('org-1')),
      adminOrganizationId: null,
      tokenHash: 'token-hash',
      expiresAt: NOW,
      ipAddress: null,
      userAgent: null,
      createdAt: NOW,
      deletedAt: LATER,
    });

    expect(session.isRevoked).toBe(true);
    expect(session.deletedAt).toBe(LATER);
  });
});
