import { ObjectId } from 'mongodb';
import { fromDate, toDate } from '../../../../../../../shared/time/Instant.js';
import { AuditLog } from '../../../../../domain/model/aggregates/AuditLog.js';
import { createAuditLogId } from '../../../../../domain/model/value-objects/AuditLogId.js';
import type { ActorType } from '../../../../../domain/model/ActorType.js';
import type { AuditLogDocument } from '../documents/AuditLogDocument.js';

/** camelCase (domain) -> snake_case (Mongo). Instant fields become BSON `Date`. */
export function toDocument(auditLog: AuditLog): AuditLogDocument {
  return {
    _id: new ObjectId(auditLog.id),
    organization_id: auditLog.organizationId === null ? null : new ObjectId(auditLog.organizationId),
    actor_type: auditLog.actorType,
    actor_id: auditLog.actorId,
    action: auditLog.action,
    resource: auditLog.resource,
    resource_id: auditLog.resourceId,
    detail: auditLog.detail,
    ip_address: auditLog.ipAddress,
    created_at: toDate(auditLog.createdAt),
  };
}

/** snake_case (Mongo) -> camelCase (domain). */
export function toDomain(document: AuditLogDocument): AuditLog {
  return AuditLog.rehydrate({
    id: createAuditLogId(document._id.toString()),
    organizationId: document.organization_id === null ? null : document.organization_id.toString(),
    actorType: document.actor_type as ActorType,
    actorId: document.actor_id,
    action: document.action,
    resource: document.resource,
    resourceId: document.resource_id,
    detail: document.detail,
    ipAddress: document.ip_address,
    createdAt: fromDate(document.created_at),
  });
}
