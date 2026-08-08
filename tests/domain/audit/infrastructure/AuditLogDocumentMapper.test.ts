import { toDocument, toDomain } from '../../../../src/modules/audit/infrastructure/adapters/outbound/mongo/mappers/AuditLogDocumentMapper.js';
import { AuditLog } from '../../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { fromDate } from '../../../../src/shared/time/Instant.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('AuditLogDocumentMapper', () => {
  it('maps a domain AuditLog to a PascalCase document with explicit nulls', () => {
    const log = AuditLog.create({
      id: createAuditLogId('audit-1'),
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

    const document = toDocument(log);

    expect(document).toEqual({
      _id: 'audit-1',
      OrganizationId: null,
      ActorType: 'PLATFORM_ADMIN',
      ActorId: 'admin-1',
      Action: 'ORGANIZATION_CREATED',
      Resource: 'organizations',
      ResourceId: null,
      Detail: {},
      IpAddress: null,
      CreatedAt: NOW,
    });
  });

  it('round-trips document -> domain -> document unchanged', () => {
    const log = AuditLog.create({
      id: createAuditLogId('audit-2'),
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

    const roundTripped = toDomain(toDocument(log));

    expect(roundTripped.toProps()).toEqual(log.toProps());
  });
});
