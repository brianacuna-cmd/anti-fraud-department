import { createRecordAuditLogUseCase } from '../../../../src/modules/audit/application/RecordAuditLog.js';
import { InMemoryAuditLogRepository } from '../../../helpers/audit/InMemoryAuditLogRepository.js';
import { FixedClock } from '../../../helpers/FixedClock.js';
import { createAuditLogId } from '../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildUseCase() {
  const auditLogs = new InMemoryAuditLogRepository();
  const record = createRecordAuditLogUseCase({
    auditLogs,
    clock: new FixedClock(NOW),
    generateAuditLogId: () => createAuditLogId('audit-1'),
  });
  return { record, auditLogs };
}

describe('createRecordAuditLogUseCase', () => {
  it('builds an AuditLog from the command and persists it', async () => {
    const { record, auditLogs } = buildUseCase();

    await record({
      organizationId: 'org-1',
      actorType: 'USER',
      actorId: 'user-1',
      action: 'USER_CREATED',
      resource: 'users',
      resourceId: 'user-2',
      detail: { field: 'value' },
      ipAddress: '127.0.0.1',
    });

    expect(auditLogs.all()).toHaveLength(1);
    const persisted = auditLogs.all()[0];
    expect(persisted?.id).toBe('audit-1');
    expect(persisted?.organizationId).toBe('org-1');
    expect(persisted?.actorType).toBe('USER');
    expect(persisted?.action).toBe('USER_CREATED');
    expect(persisted?.resource).toBe('users');
    expect(persisted?.resourceId).toBe('user-2');
    expect(persisted?.detail).toEqual({ field: 'value' });
    expect(persisted?.ipAddress).toBe('127.0.0.1');
    expect(persisted?.createdAt).toBe(NOW);
  });

  it('accepts null organizationId, resourceId, and ipAddress', async () => {
    const { record, auditLogs } = buildUseCase();

    await record({
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
      actorId: 'admin-1',
      action: 'ORGANIZATION_CREATED',
      resource: 'organizations',
      resourceId: null,
      detail: {},
      ipAddress: null,
    });

    const persisted = auditLogs.all()[0];
    expect(persisted?.organizationId).toBeNull();
    expect(persisted?.resourceId).toBeNull();
    expect(persisted?.ipAddress).toBeNull();
  });
});
