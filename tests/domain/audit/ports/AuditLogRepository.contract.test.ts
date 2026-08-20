import { oid } from '../../../support/oid.js';
import { InMemoryAuditLogRepository } from '../../../helpers/audit/InMemoryAuditLogRepository.js';
import { AuditLog } from '../../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

function buildAuditLog(overrides: { id: string; action?: string }): AuditLog {
  return AuditLog.create({
    id: createAuditLogId(overrides.id),
    organizationId: oid('org-1'),
    actorType: 'USER',
    actorId: oid('user-1'),
    action: overrides.action ?? 'USER_CREATED',
    resource: 'users',
    resourceId: oid('user-2'),
    detail: {},
    ipAddress: null,
    createdAt: NOW,
  });
}

describe('AuditLogRepository (port contract, via InMemoryAuditLogRepository fake)', () => {
  it('persists an audit log via save', async () => {
    const repository = new InMemoryAuditLogRepository();
    const log = buildAuditLog({ id: oid('audit-1') });

    await repository.save(log);

    expect(repository.all()).toHaveLength(1);
    expect(repository.all()[0]?.id).toBe(oid('audit-1'));
  });

  it('persists multiple independent audit logs', async () => {
    const repository = new InMemoryAuditLogRepository();
    await repository.save(buildAuditLog({ id: oid('audit-1'), action: 'USER_CREATED' }));
    await repository.save(buildAuditLog({ id: oid('audit-2'), action: 'USER_STATUS_CHANGED' }));

    expect(repository.all()).toHaveLength(2);
    expect(repository.all().map((log) => log.action)).toEqual(['USER_CREATED', 'USER_STATUS_CHANGED']);
  });
});
