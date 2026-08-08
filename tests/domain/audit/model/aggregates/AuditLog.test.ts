import { AuditLog } from '../../../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { fromDate } from '../../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('AuditLog.create', () => {
  it('creates an immutable audit record with all fields set', () => {
    const log = AuditLog.create({
      id: createAuditLogId('audit-1'),
      organizationId: 'org-1',
      actorType: 'USER',
      actorId: 'user-1',
      action: 'USER_CREATED',
      resource: 'users',
      resourceId: 'user-2',
      detail: { field: 'value' },
      ipAddress: '127.0.0.1',
      createdAt: NOW,
    });

    expect(log.id).toBe('audit-1');
    expect(log.organizationId).toBe('org-1');
    expect(log.actorType).toBe('USER');
    expect(log.actorId).toBe('user-1');
    expect(log.action).toBe('USER_CREATED');
    expect(log.resource).toBe('users');
    expect(log.resourceId).toBe('user-2');
    expect(log.detail).toEqual({ field: 'value' });
    expect(log.ipAddress).toBe('127.0.0.1');
    expect(log.createdAt).toBe(NOW);
  });

  it('accepts nullable organizationId, resourceId, and ipAddress (e.g. PLATFORM_ADMIN acting outside a tenant)', () => {
    const log = AuditLog.create({
      id: createAuditLogId('audit-2'),
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
      actorId: 'admin-1',
      action: 'ORGANIZATION_CREATED',
      resource: 'organizations',
      resourceId: null,
      detail: {},
      ipAddress: null,
      createdAt: NOW,
    });

    expect(log.organizationId).toBeNull();
    expect(log.resourceId).toBeNull();
    expect(log.ipAddress).toBeNull();
    expect(log.detail).toEqual({});
  });

  it('exposes no update/delete/transition methods — append-only aggregate (compile-time absence)', () => {
    const log = AuditLog.create({
      id: createAuditLogId('audit-3'),
      organizationId: 'org-1',
      actorType: 'USER',
      actorId: 'user-1',
      action: 'USER_CREATED',
      resource: 'users',
      resourceId: null,
      detail: {},
      ipAddress: null,
      createdAt: NOW,
    });

    expect((log as unknown as { update?: unknown }).update).toBeUndefined();
    expect((log as unknown as { delete?: unknown }).delete).toBeUndefined();
  });
});

describe('AuditLog.rehydrate', () => {
  it('reconstructs an audit log from stored props without re-validating', () => {
    const log = AuditLog.rehydrate({
      id: createAuditLogId('audit-1'),
      organizationId: 'org-1',
      actorType: 'USER',
      actorId: 'user-1',
      action: 'USER_CREATED',
      resource: 'users',
      resourceId: 'user-2',
      detail: { field: 'value' },
      ipAddress: '127.0.0.1',
      createdAt: NOW,
    });

    expect(log.id).toBe('audit-1');
    expect(log.detail).toEqual({ field: 'value' });
  });
});

describe('AuditLog.toProps', () => {
  it('round-trips through toProps', () => {
    const props = {
      id: createAuditLogId('audit-1'),
      organizationId: 'org-1',
      actorType: 'USER' as const,
      actorId: 'user-1',
      action: 'USER_CREATED',
      resource: 'users',
      resourceId: 'user-2',
      detail: { field: 'value' },
      ipAddress: '127.0.0.1',
      createdAt: NOW,
    };
    const log = AuditLog.create(props);

    expect(log.toProps()).toEqual(props);
  });
});
