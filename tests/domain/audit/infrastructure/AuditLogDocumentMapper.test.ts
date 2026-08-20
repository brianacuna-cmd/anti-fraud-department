import { toDocument, toDomain } from '../../../../src/modules/audit/infrastructure/adapters/outbound/mongo/mappers/AuditLogDocumentMapper.js';
import { AuditLog } from '../../../../src/modules/audit/domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../../src/modules/audit/domain/model/value-objects/AuditLogId.js';
import { fromDate, toDate } from '../../../../src/shared/time/Instant.js';
import { ObjectId } from 'mongodb';
import { oid } from '../../../support/oid.js';

const NOW = fromDate(new Date('2026-01-01T00:00:00.000Z'));

describe('AuditLogDocumentMapper', () => {
  it('maps a domain AuditLog to a snake_case document with BSON types and explicit nulls', () => {
    const log = AuditLog.create({
      id: createAuditLogId(oid('audit-1')),
      organizationId: null,
      actorType: 'PLATFORM_ADMIN',
      actorId: oid('admin-1'),
      action: 'ORGANIZATION_CREATED',
      resource: 'organizations',
      resourceId: null,
      detail: {},
      ipAddress: null,
      createdAt: NOW,
    });

    const document = toDocument(log);

    expect(document).toEqual({
      _id: new ObjectId(oid('audit-1')),
      organization_id: null,
      actor_type: 'PLATFORM_ADMIN',
      actor_id: oid('admin-1'),
      action: 'ORGANIZATION_CREATED',
      resource: 'organizations',
      resource_id: null,
      detail: {},
      ip_address: null,
      created_at: toDate(NOW),
    });
  });

  it('round-trips document -> domain -> document unchanged', () => {
    const log = AuditLog.create({
      id: createAuditLogId(oid('audit-2')),
      organizationId: oid('org-1'),
      actorType: 'USER',
      actorId: oid('user-1'),
      action: 'USER_CREATED',
      resource: 'users',
      resourceId: oid('user-2'),
      detail: { field: 'value' },
      ipAddress: '127.0.0.1',
      createdAt: NOW,
    });

    const roundTripped = toDomain(toDocument(log));

    expect(roundTripped.toProps()).toEqual(log.toProps());
  });
});
